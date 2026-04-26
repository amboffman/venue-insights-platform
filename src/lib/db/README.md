# Data Access

All database queries and mutations. The only place SQL or ORM code lives.

## Boundaries
- Returns domain types, not DB rows. Mapping happens here.
- No business logic — just data in, data out.
- No AI calls.