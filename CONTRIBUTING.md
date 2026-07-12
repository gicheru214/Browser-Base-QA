# Contributing

Trevor (`@gicheru214`) and Yaw (`@yawbtng`) are code owners for this project.

For every QA change:

1. State the customer or release risk being protected.
2. Keep production actions read-only unless an isolated write contract is approved.
3. Add or update a fast policy/contract test.
4. Run `npm test` and `npm run guardian:dry-run`.
5. Attach a Browserbase replay for live journey changes when credentials are available.
6. Do not weaken an assertion merely to make a failing run green.

Use pull requests after the initial repository foundation. Never commit secrets,
saved browser state, customer content, or generated evidence artifacts.
