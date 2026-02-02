# bee-cli

CLI client for bee.computer.

## Usage

```bash
bee [--staging] <command> [options]

# Examples
bee ping
bee ping --count 3
bee version
bee --staging auth status
```

## Commands

- `ping` - Simple connectivity check.
- `version` - Print CLI version information.
- `auth` - Store and verify developer API tokens.

## Build

```bash
bun run build
```

The binary is emitted to `dist/bee`.

## Development

```bash
bun run dev -- <command>
```
