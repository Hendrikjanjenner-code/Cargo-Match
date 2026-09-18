# Secure role-oriented demo validation

## Automated checks

- `pnpm run typecheck`: workspace libraries, API, CargoMatch, mockup sandbox and scripts passed.
- `pnpm --filter @workspace/api-server test`: 139 tests passed, including existing real auth/company/Inland/Deepsea/Liner/Road regressions and the new HTTP demo suite.
- After adding source-prompt module aliases and the optional guide flag, `pnpm --filter @workspace/api-server exec tsx --test tests/demo-domain.unit.test.ts`: 14 passed, including the additional flag check. API and frontend typechecks passed again for these changes.
- Frontend entry, legacy transition, legacy world and matcher parity tests: 22 passed.
- OpenAPI code generation, post-merge shell syntax and diff whitespace checks passed.

### Focused completion fixes

- Added an explicit `DECLINE_CONNECTION` capability and constrained interest/accept/decline transitions. Targeted demo domain plus HTTP suites passed 32 tests, covering valid recipient declines, both initiation directions, sender/NEW/CONNECTED/terminal-state rejection, and operational denials.
- Added actual rendered consent-button and fail-closed landing tests, deployment entry-policy tests, and the standard-shell authority matrix. All 15 focused frontend tests passed.
- The standard shell now applies the same activity/membership/status/module predicate to links, mode choices and direct-route child mounting.
- Production builds exclude the demo entry, persona cards and switcher; explicit or remembered demo URLs resolve to the normal landing page without calling disabled demo endpoints. Development entry also honors `DEMO_ENABLED=false`.
- Workspace typechecks and the production Vite build passed after these fixes. The generated production bundle contains no demo shortcut, persona-card or switcher text. Both running workflows restarted cleanly; the development landing screenshot has no browser errors.

The HTTP suite covers configured-origin/CSRF checks, all specified denied persona/asset requests, real/demo cookie separation, redacted serialization, independent visitor isolation, reset boundaries, expiry, disabled/production gates, concurrent switches, stale revisions, consent versus withdrawal, referrals, and rail/air/Import authorization. Domain tests compare the existing pure matchers and exercise incompatible technical inputs and consent invalidation.

## Browser walkthrough

Completed on the HTTPS development origin, using actual controls and persisted server responses:

- Explore Demo → Andy interest → Sophie acceptance → shared CONNECTED conversation → Andy refresh persistence.
- Mark assigned availability evidence → Eva referral review/interest → Laura Inland acceptance.
- Jan Truck 42, Eindhoven 14:00 UTC → Thomas referral review/interest → Laura Road acceptance.
- Anna → Laura Rail acceptance; Sarah → David Air acceptance; David → Laura Liner acceptance.
- David's ordered Import arrival/document/payment/release/pickup simulation; Laura's explicitly read-only receiver view.
- Actual Inland cargo draft creation, edit, publish and withdrawal; existing rail asset save retained its twelve-wagon specifications.
- Mobile 390×844 operational dashboard, keyboard-opened drawer and Escape close; no apparent horizontal overflow.
- Mark's direct admin and unpermitted Air URLs refused without privileged content or stack traces.
- Emma typed and confirmed reset, then Andy's primary chain returned to NEW.
- Legacy local storage prompted explicitly; preserving it did not import it, and refreshing restored the server demo without asking again.
- Cross-tab persona changes cleared stale private views. An embedded cross-site HTTPS preview also retained the demo session.

## Limits of the browser evidence

- No explicit delayed-GET browser interception was completed. Client responses are epoch-checked and aborted on context changes; concurrent switches/stale writes are additionally covered by direct HTTP tests.
- Independent visitor isolation and reset non-interference were asserted by direct HTTP tests, not a before/after two-browser UI comparison.
- Browser-wide offline navigation produced Chrome's own offline page. Restoring connectivity reloaded the demo successfully; that observation does not establish a custom in-app offline screen.
- The exact 13:30 UTC current-delivery estimate was not checked in the match-detail screen. The observed operational availability was 14:00 UTC.

Local HTTP screenshot requests are intentionally refused by configured-origin write protection. Use the configured HTTPS development origin for interactive demo acceptance; do not weaken origin validation to make localhost screenshots pass.