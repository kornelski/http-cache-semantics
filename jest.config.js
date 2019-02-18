module.exports = {
    clearMocks: true,
    collectCoverage: true,
    collectCoverageFrom: ['src/**/*.ts', '!**/*.d.ts'],
    coverageThreshold: {
        global: {
            branches: 99,
            functions: 99,
            lines: 99,
            statements: 99,
        },
    },
    preset: 'ts-jest',
    resetMocks: true,
    resetModules: true,
    restoreMocks: true,
    testEnvironment: 'node',
    verbose: true,
};
