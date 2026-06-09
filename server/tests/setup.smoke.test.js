/**
 * Smoke test: confirms Jest is wired up and every required runtime dependency loads.
 * This runs as part of task 1.1 verification and is safe to keep — it guards against
 * accidental dependency removal in later commits.
 */
describe("server scaffold", () => {
  test("loads every required runtime dependency", () => {
    expect(() => require("express")).not.toThrow();
    expect(() => require("mongoose")).not.toThrow();
    expect(() => require("jsonwebtoken")).not.toThrow();
    expect(() => require("bcryptjs")).not.toThrow();
    expect(() => require("express-validator")).not.toThrow();
    expect(() => require("helmet")).not.toThrow();
    expect(() => require("cors")).not.toThrow();
    expect(() => require("express-rate-limit")).not.toThrow();
    expect(() => require("dotenv")).not.toThrow();
    expect(() => require("axios")).not.toThrow();
  });

  test("loads every required dev/test dependency", () => {
    expect(() => require("fast-check")).not.toThrow();
    expect(() => require("supertest")).not.toThrow();
    expect(() => require("mongodb-memory-server")).not.toThrow();
  });
});
