# Install V

The extension needs the V compiler. If it is not on your `PATH`, the extension
offers to clone and build it for you.

Check whether you have it:

```
v version
```

If that prints a version, you are done. If it says the command was not found,
run **V: Show V version** from the Command Palette — the extension will tell you
whether it found a compiler and offer to install one if it did not.

The compiler is a single binary with no runtime dependencies, and `v up` updates
it in place.
