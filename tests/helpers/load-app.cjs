const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Papa = require("../../app/vendor/papaparse/papaparse.min.js");
function loadApp(overrides = {}) {
  const context = vm.createContext({ console, URL, AbortController, Date, Papa,
    window: { location: { href: "https://fixture.test/app/", pathname: "/app/" } }, ...overrides });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../app/app.js"), "utf8"), context);
  return context;
}
module.exports = { loadApp };
