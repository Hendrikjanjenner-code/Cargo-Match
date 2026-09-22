---
name: Form contract verification
description: Why request tests must use actual form serialization, especially for create versus edit.
---

Exercise the same payload builder as the form in request-contract tests;
hand-written valid request examples do not establish that the UI can save.

**Why:** A form can typecheck while serializing empty optional fields as null
against a create contract that accepts only omission. Independently prepared
fixtures can all pass while the first ordinary save fails. Update contracts
may intentionally accept null to clear a field, so create and edit need
separate assertions.

**How to apply:** Test blank optional inputs as well as populated values.
Preserve null for intentional clearing on edit and omit unsupported optional
values on create. Avoid weakening all schemas merely to accommodate a form.

Action-based forms also need this check when a shared action type makes most
properties optional. Static typing then cannot prove that review evidence,
the correct operation-specific field name, or a required role transition is
actually supplied by the screen.

**Why:** Valid domain tests can conceal unusable review and approval controls
whose real requests omit mandatory human evidence.

**How to apply:** Trace the actual UI payload through the action dispatcher and
check who can reach each control, not just whether the server supports it.