// Flat ESLint config for the Spotlight Studio mobile app.
// Run with: npm run lint
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const TEST_GLOBALS = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  jest: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'dist/**',
      'coverage/**',
      '.expo/**',
      'expo-env.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'warn',
      'react/display-name': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-unused-vars': 'off', // TypeScript handles this (see @typescript-eslint)
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', 'jest.setup.ts'],
    languageOptions: { globals: TEST_GLOBALS },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Jest suites hoist `jest.mock()` above the imports on purpose and the factories must
    // `require()` the doubles – both are correct here even though the general rules are not.
    files: ['tests/**/*.{ts,tsx}', 'jest.setup.ts'],
    rules: {
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...TEST_GLOBALS, require: 'readonly', module: 'writable', __dirname: 'readonly' } },
  },
]);
