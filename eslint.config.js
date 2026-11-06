import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/.lontar/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/lontar-types.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Only cognitive-complexity is enabled from sonarjs; its recommended preset is too noisy.
    plugins: { sonarjs },
    rules: {
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // A Radix *.Portal used without an explicit container renders into
    // document.body, outside the .lontar-admin wrapper the admin's CSS is
    // scoped to. The wrappers in components/ui bind that container; this keeps
    // the rest of the package from going around them.
    // See docs/adr/0019-admin-shadcn-tailwind-scoping.md, rule 3.
    files: ['packages/admin/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@radix-ui/*'],
              message:
                'Import the wrapper from @/components/ui instead, so the Radix portal keeps its PortalContainer (docs/adr/0019 rule 3).',
            },
          ],
        },
      ],
    },
  },
  {
    // The wrappers themselves are the one place Radix is imported directly.
    files: ['packages/admin/src/components/ui/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Config files are plain JS and are not covered by a tsconfig project.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
