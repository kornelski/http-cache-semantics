/** @type {import('jest').Config} */
export default {
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/'],
  testEnvironment: 'miniflare',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};