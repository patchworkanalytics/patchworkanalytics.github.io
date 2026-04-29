---
title: 'Multi-user Homebrew: one installation, shared access'
description: 'Setting up Homebrew on a multi-user setup without chmod'
pubDate: 2025-02-18
tags: ['homebrew', 'macos', 'tools', 'setup']
draft: false
slug: multi-user-homebrew
---

In my work as a contractor, I have often been expected to source my own equipment. This is convenient for many reasons, but comes with some significant drawbacks - primarily, the need keep my personal stuff (files, environments, configs) isolated from my employer's/client's stuff. Of course, most modern operating systems make it easy to create multiple admin-level user accounts, so creating a dedicated user account for work has made keeping most of my files and apps separate pretty easy. However, this multi-user-account solutions poses some issues with my dev tools. 

I typically use [Homebrew](brew.sh) to manage my dev-related installations. However, the Homebrew FAQ's state clearly that brew is designed [for single-user systems](https://docs.brew.sh/FAQ#what-is-the-default-ownership-and-permissions-used-by-homebrew), not multi-user ones, and multiple installations are both unsupported and can cause path issues with many packages. 

Fortunately, I came across [this truly excellent blog post](https://www.codejam.info/2021/11/homebrew-multi-user.html) while searching for a solution that did not involve `chmod`/`chgrp` (which felt sketchy and fragile to me even before reading that analysis). Go read it, because it's awesome and explains so much more in depth than I will here, but in summary, the elegant way for two (mutually trusted) users on one system to both use `brew` is to install `brew` in one user normally, then assume the role of that user using sudo when calling `brew <command>` in the other user account(s). Obviously, this assumes that 

## Setting up the second user
This assumes that you have already [installed Homebrew](https://docs.brew.sh/Installation#post-installation-steps) normally on your main user, following the standard directions. For the purposes of this post, I'll assume that brew has been installed by the user named **MAIN**, and you're setting up a secondary user named **ALT**. 

Note that I'm on an M4 Mac -- if you're running an older Mac or Linux, your paths [may be different](https://docs.brew.sh/FAQ#why-is-the-default-installation-prefix-opthomebrew-on-apple-silicon). 

[//]: # (Also note that you *could* create a separate `homebrew` user just for the homebrew install, then all other accounts alias to that user & behave identically. In this case, since all accounts are me, this is more complicated than necessary. If you're trying to do this on a machine used by multiple people that need all need to use homebrew, this is probably a smarter way to go. Of course, this assumes that all users can be trusted with the homebrew )

### Use `brew` commands on the **ALT** account
#### Create an alias for `brew` that includes the installer-user-impersonation

In your **ALT** user account, you'll need to alias the `brew` command to include the user-impersonation step. As explained in the original post, Homebrew won't work directly with `sudo` mainly for security reasons. But with this approach, you are not giving Homebrew sudo -- you are using sudo to run brew commands as a different user 

I added the following alias to my `.zshrc` on **ALT**. This way, `brew <command>` works the same on both user accounts, with the addition of a password prompt in **ALT**. 

```shell
alias brew='sudo -Hu <MAIN> -i brew'
```

Depending on your setup, you may or may not need the `-i` to force a login shell start. This should allow you run brew commands as if you were the **MAIN** user. 

### Use packages installed with `brew` on the **ALT** account
#### Ensure that your paths & prefixes in **ALT** are updated to include Homebrew 

Next, you'll need to make sure that Homebrew gets added to your `PATH` in the **ALT** account, so that the **ALT** user can find & use packages installed to brew. Luckily, Homebrew provides a [convenient method](https://docs.brew.sh/Manpage#shellenv-shell-) to set everything up correctly. This is done in on your **MAIN** account when you followed the [post-installation steps](https://docs.brew.sh/Installation#post-installation-steps) that are output by the homebrew installation script. I had forgotten entirely about these post-install steps at first, probably because I was creating the alt account long after I'd set up my main account. This resulted in a few frustrating minutes where `brew` commands were working on my **ALT**, but I was unable to see or use any of the installed packages. To fix this, you simply need to execute these post-install steps on the second account.

I added the following to my `.zprofile`, so that it loads with every new session. 

```shell
eval "$(/opt/homebrew/bin/brew shellenv)"
```

After, you'll either need to start a new shell, source your .zprofile (`source ~/.zprofile`), or run `eval "$(/opt/homebrew/bin/brew shellenv)"` directly (all three do the same thing). 

