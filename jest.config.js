module.exports = {
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {tsconfig: "test/tsconfig.json"}]
  },
  moduleFileExtensions: ["ts", "js"],
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "src/**/*.js"],
  testMatch: ["**/*.spec.(ts)"],
  testEnvironment: "node",
  // One worker. Every integration suite boots the real app against the single `mobile_test`
  // database, and node-pg-migrate takes an advisory lock for the duration of its run. Suites
  // that come up together contend for it, and the app-boot path has no retry — it surfaces as
  // "Another migration is already running" and the suite dies before a test runs. Suites also
  // each bind an HTTP port, which is the other thing that cannot overlap.
  maxWorkers: 1,
}
