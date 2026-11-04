# @lontar/cli

Command-line tool for [Lontar](https://github.com/handi7/lontar-cms): database migrations and TypeScript type generation from your `lontar.config.ts`.

```bash
pnpm add -D @lontar/cli
```

```bash
pnpm lontar migrate:create   # diff config against the DB schema, write a migration file
pnpm lontar migrate          # run migrations
pnpm lontar generate:types   # write lontar-types.ts
pnpm lontar create-user      # create an admin user
```

The CLI automatically loads environment variables from `.env` (and `.env.local` if present). You can also pass a custom env file with `--env-file <path>`.

Requires `@lontar/core` as a peer dependency. See the [main README](https://github.com/handi7/lontar-cms#readme) for the full guide.

## License

MIT
