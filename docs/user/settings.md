# Settings files

Ronin preserves symbolic links when saving server settings, desktop app settings, and desktop
client preferences. You can keep those files in a dotfiles directory and link them into Ronin's
data directory. Saving from Settings updates the destination file and leaves the link in place.

The environment also notices changes to its linked server settings, including replacing the
destination file or repointing the link.
