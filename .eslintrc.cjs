module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['node_modules', '.next', '.expo', 'dist', 'coverage'],
  overrides: [
    {
      files: ['apps/mobile/**/*.{ts,tsx}'],
      globals: { __DEV__: 'readonly' },
    },
    {
      files: ['apps/mobile/App.web.tsx'],
      env: { browser: true },
    },
    {
      files: ['apps/api/**/*.ts'],
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'error',
      },
    },
  ],
};
