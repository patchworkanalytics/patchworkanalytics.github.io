---
title: "Python Module (Hot-)Reloading & Class Identity Issues with `isinstance()`"
description: "Using `isinstance()` to compare user-defined classes (don't do this)"
pubDate: 2026-01-29
tags: ['python', 'bugs', 'best-practices', 'jupyter']
draft: false
slug: isinstance-hot-reload
---

Recently, I was working on updating a data ingestion pipeline in [mage.ai](mage.ai), and ran into a cryptic error message relating to the Pydantic models I was relying on for data structure validation: 

<pre class="python-block-error">
ValidationError: 1 validation error for Container
queries.0
  Input should be a valid dictionary or instance of DummyModel [type=model_type, input_value=DummyModel(source_id='test_id', value=42), input_type=DummyModel]
    For further information visit https://errors.pydantic.dev/2.12/v/model_type
</pre>

Several hours and much hair-pulling later, I determined that the comparisons (in this case, of custom Pydantic models) with `isinstance()` that were being done in one of the packages I was using were the culprit. `isinstance()` relies on class identity, and is therefore unsafe in hot-reload or distributed environments such as data pipeline tools (mage.ai, dagster), distributed pipeline frameworks (dlt), Jupyter notebooks, or other environments with hot-reload enabled (e.g FastAPI/uvicorn with --reload). The reason is that class identity is tied to when and where the class was imported, and independent block loads (or reloads) of a class may differ. This means that two independently imported copies of the same object (imported during different reloads) may fail to have equivalent class identities even when their structure (eg, model fields) is correct.

I'll walk through the potential problems with using `isinstance()` to compare objects here, and propose a drop-in replacement solution that can be added as a more robust alternative to using `isinstance()` to check your class objects. 

## Setup
python environment requirements:
- jupyter
- pydantic


```python
import sys
import os
from pathlib import Path

temp_dir = Path(".").resolve() / "_temp_model"
temp_dir.mkdir(exist_ok=True)

module_path = temp_dir / "demo.py"
module_path.write_text("""
from pydantic import BaseModel
from typing import List

class DummyModel(BaseModel):
    source_id: str
    value: int = 0

class Container(BaseModel):
    queries: List[DummyModel]
""")

# print(f"Created temporary module at: {module_path}")

sys.path.insert(0, str(temp_dir))

# # uncomment to clean up the temp_dir
# import shutil
# 
# temp_dir_str = str(temp_dir)
# if temp_dir_str in sys.path:
#     sys.path.remove(temp_dir_str)
# 
# if 'demo' in sys.modules:
#     del sys.modules['demo']
# 
# shutil.rmtree(temp_dir, ignore_errors=True)
```

## isinstance() works when the model is first loaded
Note, there is nothing wrong with the model itself with regards to loading or validating input data -- just in the identity checks against different import "clones" of the same model


```python
from demo import DummyModel

OriginalModel = DummyModel
query = DummyModel(source_id="test_id", value=42)

print(f"Class object id: {id(DummyModel)}")
print(f"Instance: {query}")
print(f"check if isinstance(query, DummyModel): {isinstance(query, DummyModel)}")
```
<pre class="python-block-output"
>Class object id: 4378943392
Instance: source_id='test_id' value=42
check if isinstance(query, DummyModel): True
</pre>

## `isinstance()` comparison fails when the module is reloaded / loaded a second time

Normally Python caches imported modules. In hot-reload environments/ distributed environments, such as the data pipelining tool we are using, each block loads its own modules independent of the others. The new object gets a new location in memory, so identity comparisons fail.

This scenario is slightly contrived, to demonstrate the behaviour. In the real-world scenario, the reload happens automatically behind the scenes.


```python
import importlib
import demo

importlib.reload(demo)
from demo import DummyModel as ReloadedModel

print(f"Original class id (v1): {id(OriginalModel)}")
print(f"Reloaded class id (v2): {id(ReloadedModel)}")
print()
print(f"Check if isinstance(OriginalModel, ReloadedModel): {isinstance(OriginalModel, ReloadedModel)}")
```

<pre class="python-block-output"
>Original class id (v1): 4378943392
Reloaded class id (v2): 4378948336
Check if isinstance(OriginalModel, ReloadedModel): False
</pre>


## comparison with isinstance() fails

This has to be one of the most headache-inducing error messages in existence!!


```python
def validate_query_with_isinstance(obj):
    if not isinstance(obj, ReloadedModel):
        raise ValueError(f"Expected DummyModel, got {type(obj).__name__}")
    return True

print(f"query was created from class: {id(type(query))}")
print(f"Checking against class:       {id(ReloadedModel)}")
print()
print(f"isinstance(query, ReloadedModel): {isinstance(query, ReloadedModel)}")
print(f"type(query).__name__: {type(query).__name__}")
print()
print("When you run in a pipeline:")
try:
    validate_query_with_isinstance(query)
    print("\tValidation succeeded (can proceed to retrieving data with the query)")
except ValueError as e:
    print(f"\tValidation of DummyModel failed: {e}")
```

<pre class="python-block-output">
query was created from class: 4378943392
Checking against class:       4378948336

isinstance(query, ReloadedModel): False
type(query).__name__: DummyModel

When you run in a pipeline:
    Validation of DummyModel failed: Expected DummyModel, got DummyModel
</pre>

And in a typical usage, a ValidationError gets raised: 

```python
from demo import Container

query_seq = Container(queries=[query])

for q in query_seq:
    if not isinstance(q, ReloadedModel):
        raise ValueError(f"Expected DummyModel, got {type(q).__name__}")
```

<pre class="python-block-error">
ValidationError                           Traceback (most recent call last)
Cell In[5], line 3
      1 from demo import Container
----> 3 query_seq = Container(queries=[query])
      5 for q in query_seq:
      6     if not isinstance(q, ReloadedModel):

File ~/repos/test_new_sdk/.venv/lib/python3.13/site-packages/pydantic/main.py:250, in BaseModel.__init__(self, **data)
    248 # `__tracebackhide__` tells pytest and some other tools to omit this function from tracebacks
    249 __tracebackhide__ = True
--> 250 validated_self = self.__pydantic_validator__.validate_python(data, self_instance=self)
    251 if self is not validated_self:
    252     warnings.warn(
    253         'A custom validator is returning a value other than `self`.\n'
    254         "Returning anything other than `self` from a top level model validator isn't supported when validating via `__init__`.\n"
    255         'See the `model_validator` docs (https://docs.pydantic.dev/latest/concepts/validators/#model-validators) for more details.',
    256         stacklevel=2,
    257     )

ValidationError: 1 validation error for Container
queries.0
  Input should be a valid dictionary or instance of DummyModel [type=model_type, input_value=DummyModel(source_id='test_id', value=42), input_type=DummyModel]
    For further information visit https://errors.pydantic.dev/2.12/v/model_type
</pre>


## Summary: solution to direct `isinstance()` checks for project libraries
Two private methods can be added to your library to get around this problem 

`_is_pydantic_model` - validates via duck typing that `obj` has "model_fields" and "model_dump", ie that it is a Pydantic model. (This function is not strictly required — it depends on what level of validation is needed and how much overhead is acceptable.)

[//]: # (<div class="sidenote">Note: this function is not strictly required — it depends on what level of validation is needed and how much overhead is acceptable</div>)

`_matches_pydantic_model` - This implements a method for checking that a pydantic model object (`obj`) passed to `_matches_pydantic_model` is:
1) a pydantic model (this can be eliminated if desired)
2) has the same structure (model_fields) as the comparator (`target`) pydantic model

Checking that the fields are identical validates the structure, but bypasses the issues caused by hot-reloading and `isinstance()`

As far as I have been able to test, this solves the validation issues on my end.

Fully aware there may be considerations/constraints to doing this on the backend I'm not aware of - happy to iterate with someone if needed to make sure this gets fixed

#### Side note:
Pydantic v2.11+ deprecates accessing model_fields directly on instances, and this will be removed in v3.0. The new pattern is to access it through the class instead.



```python
from typing import Any, TypeVar

T = TypeVar("T")

def _is_pydantic_model(obj: object) -> bool:
    """Checks if the object is a Pydantic model"""
    return hasattr(type(obj), "model_fields") and hasattr(type(obj), "model_dump")

def _matches_pydantic_model(obj: Any, target: type[T]) -> bool:
    """
    Validate `obj` as a Pydantic model with the same fields as `target`.

    Checks that `obj` model's class name and structure (model_fields) match the expected Pydantic
    model `target`.  instead of using isinstance(). This avoids class identity & comparison
    issues that can occur with `isinstance()` checks in hot-reloading environments
    (eg, Jupyter/interactive shells, DAG-based data pipelining tools, other interactive envs).

    Args:
        obj: The object to validate
        target: The Pydantic model class to compare against

    Returns:
        True if obj has the same class name and all the fields defined in target
    """
    if not _is_pydantic_model(obj):
        raise ValueError(f"Expected Pydantic model, got {type(obj).__name__}")
    return (
        target.__name__ == type(obj).__name__
        and set(target.model_fields.keys()) == set(type(obj).model_fields.keys())
    )
```

### Example post-implementation:
    

```python
def validate_query_robust(obj):
    if not _matches_pydantic_model(obj, ReloadedModel):
        raise ValueError(f"Expected DummyModel, got {type(obj).__name__}")
    return True

print(f"model fields in ReloadedModel: {set(ReloadedModel.model_fields.keys())}")
print(f"model fields in OriginalModel: {set(OriginalModel.model_fields.keys())}")
print(f"model fields in query:         {set(type(query).model_fields.keys())}")
print()
print("Now when you run in a pipeline:")

try:
    validate_query_robust(query)
    print("\tValidation succeeded (can proceed to retrieving data from the API with the query)")
except ValueError as e:
    print(f"\tValidation of DummyModel failed: {e}")
```

<pre class="python-block-output">
model fields in ReloadedModel: {'source_id', 'value'}
model fields in OriginalModel: {'source_id', 'value'}
model fields in query:         {'source_id', 'value'}
---
name of ReloadedModel:         DummyModel
name of OriginalModel:         DummyModel
name of query:                 DummyModel

Now when you run in a pipeline:
	Validation succeeded (can proceed to retrieving data from the API with the query)
</pre>

---