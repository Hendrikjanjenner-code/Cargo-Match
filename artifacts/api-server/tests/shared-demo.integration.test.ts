import assert from "node:assert/strict";
import { once } from "node:events";
import test, {before, after, beforeEach} from "node:test";
import {pool} from "@workspace/db";

const origin = "https://shared-demo-test.example.invalid";
const namespace = `test-shared-${process.pid}`;
let server: import("node:http").Server, url = "", visitor = 1;
type Jar = {cookie: string; session: any};
async function request(path: string, jar?: Jar, body?: unknown) {
  const response = await fetch(`${url}/api/demo/${path}`, {method: body === undefined ? "GET" : "POST", headers: {
    origin, "x-forwarded-host": "shared-demo-test.example.invalid", "x-forwarded-proto": "https",
    "x-forwarded-for": `192.0.2.${visitor}`, "x-demo-request": "1", "content-type": "application/json",
    ...(jar ? {cookie: jar.cookie, "x-demo-csrf": jar.session.csrfToken, "x-demo-revision": String(jar.session.revision)} : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text(), data = text ? JSON.parse(text) : null;
  if (response.ok && jar && data?.context) jar.session = data;
  return {status: response.status, data, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")};
}
async function start(personaId: string): Promise<Jar> {
  const r = await request("start", undefined, {personaId});
  assert.equal(r.status, 201, JSON.stringify(r.data)); return {cookie: r.cookie, session: r.data};
}
async function act(jar: Jar, body: unknown, expected = 200) {
  const r = await request("actions", jar, body);
  assert.equal(r.status, expected, JSON.stringify(r.data)); return r;
}
async function reload(jar: Jar) { assert.equal((await request("session", jar)).status, 200); }
const match = (jar: Jar, id: string) => jar.session.workspace.matches.find((m: any) => m.id === id);
before(async () => {
  process.env.NODE_ENV = "test"; process.env.DEMO_TEST_ECOSYSTEM = namespace; process.env.APP_ORIGIN = origin; delete process.env.DEMO_ENABLED;
  const {default: app} = await import("../src/app");
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string"); url = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  visitor++;
  const admin = await start("emma"); await act(admin, {type: "RESET", confirmation: "RESET ALL DEMO DATA?"});
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.query("DELETE FROM demo_sessions WHERE ecosystem_id=$1", [namespace]);
  await pool.query("DELETE FROM demo_ecosystems WHERE id=$1", [namespace]);
});
test("two independent account cookies share consent, exactly one conversation, messages and read state", async () => {
  const andy = await start("andy"), sophie = await start("sophie");
  assert.notEqual(andy.cookie, sophie.cookie);
  assert.equal(match(andy, "match-deepsea").contact, undefined);
  await act(andy, {type: "MESSAGE", matchId: "match-deepsea", body: "forbidden"}, 403);
  await act(andy, {type: "INTEREST", matchId: "match-deepsea"});
  await reload(sophie);
  assert.equal(match(sophie, "match-deepsea").status, "INTEREST_SENT");
  assert.ok(sophie.session.workspace.notifications.some((n: any) => n.title === "Nieuwe interesse ontvangen."));
  const racing = await Promise.all([request("actions", sophie, {type:"ACCEPT",matchId:"match-deepsea"}), request("actions", sophie, {type:"ACCEPT",matchId:"match-deepsea"})]);
  assert.deepEqual(racing.map(r=>r.status).sort(), [200,409]);
  await reload(andy); await reload(sophie);
  assert.equal(match(andy,"match-deepsea").conversationId, match(sophie,"match-deepsea").conversationId);
  assert.ok(match(andy,"match-deepsea").contact);
  await act(andy,{type:"MESSAGE",matchId:"match-deepsea",body:"Can you confirm expected open position?"});
  await reload(sophie);
  const message = sophie.session.workspace.messages.find((m:any)=>m.matchId==="match-deepsea");
  assert.equal(message.senderId,"andy"); assert.equal(message.body,"Can you confirm expected open position?");
  await act(sophie,{type:"READ_CONVERSATION",matchId:"match-deepsea"});
  await act(sophie,{type:"MESSAGE",matchId:"match-deepsea",body:"Confirmed manually."});
  await reload(andy);
  assert.ok(andy.session.workspace.messages.find((m:any)=>m.id===message.id).readBy.includes("sophie"));
  const rejoined = await start("andy");
  assert.equal(match(rejoined,"match-deepsea").status,"CONNECTED");
  assert.equal(rejoined.session.workspace.messages.filter((m:any)=>m.matchId==="match-deepsea").length,2);
  const count = await pool.query("SELECT count(*)::int n FROM demo_ecosystems WHERE id=$1", [namespace]); assert.equal(count.rows[0].n,1);
  const ids = await pool.query("SELECT count(*)::int n FROM demo_memberships WHERE user_id='andy'"); assert.equal(ids.rows[0].n,1);
  await request("switch", andy, {personaId:"laura"}); await reload(sophie);
  assert.equal(sophie.session.context.user.id,"sophie");
  await act(andy,{type:"MESSAGE",matchId:"match-deepsea",body:"not participant"},403);
});
test("independent skipper/driver referrals carry review and commercial status back", async () => {
  for (const [operator, planner, mode] of [["mark","eva","inland"],["jan","thomas","road"]]) {
    const worker=await start(operator), manager=await start(planner);
    if(mode==="road") assert.equal(match(worker,"match-road").positioningDistanceKm,18);
    await act(worker,{type:"INTEREST",matchId:`match-${mode}`},403);
    await act(worker,{type:"SEND_TO_PLANNER",matchId:`match-${mode}`});
    await reload(manager);
    const referral=manager.session.workspace.referrals.find((r:any)=>r.fromUserId===operator);
    assert.ok(referral);
    await act(manager,{type:"REVIEW_REFERRAL",referralId:referral.id});
    await reload(worker); assert.equal(worker.session.workspace.referrals[0].status,"REVIEWED");
    await act(manager,{type:"INTEREST",matchId:`match-${mode}`});
    await reload(worker); assert.equal(worker.session.workspace.referrals[0].status,"INTEREST_SENT");
  }
});
test("rail and air commercial matches connect across independent accounts", async () => {
  for (const [cargo,carrier,mode] of [["laura","anna","rail"],["david","sarah","air"]]) {
    const left=await start(cargo),right=await start(carrier);
    await act(left,{type:"INTEREST",matchId:`match-${mode}`});
    await reload(right); await act(right,{type:"ACCEPT",matchId:`match-${mode}`});
    await reload(left); assert.equal(match(left,`match-${mode}`).status,"CONNECTED");
  }
});
test("import arrival creates idempotent eligible road, container barge and rail delivery requirements", async () => {
  const michael=await start("michael");
  for (const [shipmentId,mode,planner] of [["china-fcl","road","thomas"],["import-inland","inland","eva"],["import-rail","rail","anna"]]) {
    await act(michael,{type:"IMPORT_CONTROL",operation:"ARRIVING",shipmentId,evidence:"Demo ETA confirmed."});
    let shipment=michael.session.workspace.importControl.shipments.find((s:any)=>s.id===shipmentId);
    assert.equal(shipment.delivery.requirementId,`delivery-requirement-${shipmentId}`);
    assert.equal(shipment.delivery.listingIds.length,1);
    const cargoId=shipment.delivery.listingIds[0];
    const option=michael.session.workspace.matches.find((m:any)=>m.cargoId===cargoId&&m.capacityId===`capacity-import-${mode}`&&m.status==="NEW");
    assert.ok(option,`Expected physically eligible ${mode} capacity`);
    await act(michael,{type:"IMPORT_CONTROL",operation:"FIND_DELIVERY",shipmentId});
    assert.equal(michael.session.workspace.cargos.filter((c:any)=>c.id===cargoId).length,1);
    const carrier=await start(planner);
    assert.equal(match(carrier,option.id).ownSide,"CAPACITY");
    await act(michael,{type:"INTEREST",matchId:option.id});
    await reload(carrier); await act(carrier,{type:"ACCEPT",matchId:option.id});
    await reload(michael); assert.equal(match(michael,option.id).status,"CONNECTED");
    await act(michael,{type:"IMPORT_CONTROL",operation:"PLAN_DELIVERY",shipmentId,matchId:option.id,evidence:"Not released"},409);
  }
});
test("assigned customs review and three-house consolidation remain account-scoped", async () => {
  const michael=await start("michael"), natalie=await start("natalie"), david=await start("david");
  assert.equal(natalie.session.workspace.importControl.shipments.length,0);
  await act(michael,{type:"IMPORT_CONTROL",operation:"ASSIGN_CUSTOMS_REVIEW",shipmentId:"china-fcl",userId:"natalie",evidence:"Classification review required."});
  await reload(natalie);
  assert.deepEqual(natalie.session.workspace.importControl.shipments.map((s:any)=>s.id),["china-fcl"]);
  assert.ok(natalie.session.workspace.notifications.some((n:any)=>n.importShipmentId==="china-fcl"));
  await act(natalie,{type:"IMPORT_CONTROL",operation:"CUSTOMS_REVIEW_OPEN",shipmentId:"china-fcl"});
  await act(natalie,{type:"IMPORT_CONTROL",operation:"CUSTOMS_REVIEW_COMPLETE",shipmentId:"china-fcl",evidence:"Recommend human verification of classification and source weights."});
  await reload(michael);
  const china=michael.session.workspace.importControl.shipments.find((s:any)=>s.id==="china-fcl");
  assert.equal(china.customsReview.status,"COMPLETED"); assert.equal(china.readiness.status,"BLOCKED");
  assert.equal(china.customs.status,"DRAFT");
  assert.equal(china.documents.find((d:any)=>d.type==="BILL_OF_LADING").fields.weightKg,18240);
  await act(natalie,{type:"IMPORT_CONTROL",operation:"CUSTOMS_EDIT",shipmentId:"india-house-1",field:"hsCode",value:"6204",evidence:"forged"},403);
  for(const [persona,id] of [["laura","india-house-1"],["consignee","india-house-2"],["consignee-c","india-house-3"]]) {
    const receiver=await start(persona);
    assert.deepEqual(receiver.session.workspace.importControl.shipments.map((s:any)=>s.id),[id]);
    const denied=await request(`import/documents/china-fcl/china-fcl-doc-1`,receiver); assert.equal(denied.status,403);
  }
  assert.ok(david.session.workspace.importControl.shipments.some((s:any)=>s.id==="india-master"));
  assert.equal(david.session.workspace.importControl.shipments.filter((s:any)=>s.parentId==="india-master").length,3);
});
test("global reset invalidates other sessions; logout and reseed never erase shared state", async () => {
  const andy=await start("andy"), sophie=await start("sophie"), admin=await start("emma");
  await act(andy,{type:"INTEREST",matchId:"match-deepsea"});
  assert.equal((await request("logout",andy,{})).status,204);
  await reload(sophie); assert.equal(match(sophie,"match-deepsea").status,"INTEREST_SENT");
  await act(admin,{type:"RESET",confirmation:"RESET DEMO"},400);
  await act(admin,{type:"RESET",confirmation:"RESET ALL DEMO DATA?"});
  await act(sophie,{type:"ACCEPT",matchId:"match-deepsea"},409);
  await reload(sophie); assert.equal(match(sophie,"match-deepsea").status,"NEW");
  const again=await start("andy"); assert.equal(match(again,"match-deepsea").status,"NEW");
});