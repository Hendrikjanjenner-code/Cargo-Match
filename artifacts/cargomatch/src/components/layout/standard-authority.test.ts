import assert from "node:assert/strict";
import test from "node:test";
import { standardAuthority, standardModuleForPath, STANDARD_MODULE_STATES } from "./standard-authority";

const company = (activities: string[], membershipRole = "OWNER", status = "ACTIVE") =>
  ({ activities, membershipRole, status });

test("carrier owner sees fleet/capacity and selects a working home in every supported module", () => {
  const authority = standardAuthority(company(["CARRIER"]));
  assert.deepEqual(authority.allowedModules, ["inland", "deepsea", "liner", "road"]);
  for (const route of ["/vessels", "/capacity", "/deepsea/vessels", "/liner/services", "/road/assets"]) {
    assert.equal(authority.canVisit(route), true, route);
  }
  for (const route of ["/cargo", "/deepsea/cargo", "/liner/cargo", "/road/cargo"]) {
    assert.equal(authority.canVisit(route), false, route);
  }
  for (const mode of authority.allowedModules) assert.equal(authority.canVisit(authority.moduleHome(mode)), true);
});

test("shipper and charterer navigation opens cargo, not carrier administration", () => {
  for (const activity of ["SHIPPER", "CHARTERER"]) {
    const authority = standardAuthority(company([activity], "ADMIN"));
    for (const route of ["/cargo", "/deepsea/cargo", "/liner/cargo", "/road/cargo"]) assert.equal(authority.canVisit(route), true);
    for (const route of ["/vessels", "/capacity", "/liner/services", "/road/assets"]) assert.equal(authority.canVisit(route), false);
    assert.equal(authority.moduleHome("deepsea"), "/deepsea/cargo");
    assert.equal(authority.moduleHome("liner"), "/liner/cargo");
    assert.equal(authority.moduleHome("road"), "/road/cargo");
  }
});

test("mixed activities retain both sides; MEMBER retains real maritime reads and assigned-only road pages", () => {
  const owner = standardAuthority(company(["CARRIER", "SHIPPER"]));
  assert.equal(owner.canVisit("/road/cargo"), true);
  assert.equal(owner.canVisit("/road/assets"), true);
  const member = standardAuthority(company(["CARRIER", "SHIPPER"], "MEMBER"));
  assert.equal(member.commercial, false);
  for (const route of ["/vessels", "/cargo", "/liner/services", "/road/assets", "/road/capacity", "/road/opportunities", "/road/matches/example"]) {
    assert.equal(member.canVisit(route), true, route);
  }
  assert.equal(member.canVisit("/road/cargo"), false);
  // A role never asserts assignment: only the road API can provide assigned rows.
  assert.equal(standardAuthority(company(["SHIPPER"], "MEMBER")).canVisit("/road/assets"), true);
});

test("disabled states and unsupported pilots cannot be opened through direct routes", () => {
  const authority = standardAuthority(company(["CARRIER", "SHIPPER"]), {
    ...STANDARD_MODULE_STATES, road: "HIDDEN", deepsea: "COMING_LATER",
  });
  assert.deepEqual(authority.allowedModules, ["inland", "liner"]);
  for (const route of ["/road/assets", "/road/matches/123", "/deepsea/cargo", "/rail", "/air/cargo", "/import", "/vessels/unrecognized-editor"]) {
    assert.equal(authority.canVisit(route), false, route);
  }
});

test("missing or inactive authority fails closed while own company context remains readable", () => {
  for (const value of [null, company(["CARRIER"], "UNKNOWN"), company(["CARRIER"], "OWNER", "SUSPENDED"), company(["CARRIER"], "ADMIN", "CLOSED")]) {
    const authority = standardAuthority(value);
    assert.equal(authority.allowedModules.length, 0);
    assert.equal(authority.canVisit("/"), false);
    assert.equal(authority.canVisit("/capacity"), false);
    assert.equal(authority.canVisit("/company"), !!value);
  }
  assert.equal(standardAuthority(company([])).allowedModules.length, 0);
});

test("exact route matching keeps detail views accessible without prefix bypasses", () => {
  const authority = standardAuthority(company(["CARRIER"]));
  assert.equal(authority.canVisit("/matches/example?filter=all"), true);
  assert.equal(authority.canVisit("/deepsea/matches/example"), true);
  assert.equal(authority.canVisit("/liner/matches/example"), true);
  assert.equal(authority.canVisit("/messages/example"), true);
  assert.equal(authority.canVisit("/road/cargo/../assets"), false);
  assert.equal(authority.canVisit("/deepsea-other/vessels"), false);
  assert.equal(standardModuleForPath("/road/matches/example"), "road");
});