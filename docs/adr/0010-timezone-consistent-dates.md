# 0010: Timezone-consistent date field handling and storage

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Prior to this decision, editing and saving `date` fields in the admin panel caused dates to drift by the local timezone offset on every save:

1. **Incorrect input formatting**:
   The admin formatted values for `<input type="datetime-local">` using `new Date(val).toISOString().slice(0, 16)`, which extracts the UTC wall clock instead of the user's local time. In UTC+7, a stored time of `03:00Z` displayed as `03:00` instead of `10:00`.
2. **Offset-less string submission**:
   On form submission, the admin sent the bare string from the input (e.g., `"2024-05-01T03:00"` without offset).
3. **Server local timezone parsing**:
   The backend parsed date strings using `new Date(str)`, which ECMAScript interprets as local time for strings without a timezone specifier. When the server ran in UTC+7, saving `"2024-05-01T03:00"` was interpreted as `2024-04-30T20:00:00.000Z`, shifting the date backwards by 7 hours on every save without the user changing the field.
4. **Database timezone ambiguity**:
   The MySQL connection pool did not configure an explicit timezone, defaulting to the MySQL server or local machine timezone.

## Decision

1. **Admin Local Presentation & ISO Submission**:
   - In `@lontar/admin`, created shared form utilities in `src/utils/form-utils.ts`:
     - `formatDateForInput`: Formats Date or ISO string into `YYYY-MM-DDTHH:mm[:ss]` according to the user's browser local time.
     - `formatDateForSubmit`: Converts local `datetime-local` input values back to an absolute UTC ISO-8601 string (`new Date(val).toISOString()`).
     - `formatDocForSubmit`: Recursively maps date fields to UTC ISO strings before sending payloads via REST API or multipart FormData.
   - Refactored `CollectionFormView` and `GlobalFormView` to use these shared helpers across defaults, form load, and submission.
   - Added `step="1"` to `DateFieldInput` so that seconds can be preserved when present.

2. **Server-Side UTC Normalization & Driver Configuration**:
   - In `@lontar/db-mysql/src/adapter.ts`:
     - `sanitizeDate`: Normalizes any offset-less date strings by appending `Z` so they are explicitly treated as UTC instants regardless of the server process's local timezone.
     - `mysql.createPool`: Configured with `timezone: 'Z'` so date values sent to and received from MySQL are uniformly in UTC.

## Consequences

- Prevents date drift on form saves regardless of client or server timezone offsets.
- Guarantees visual consistency between collection list views (`toLocaleString()`) and form edit inputs (`formatDateForInput()`).
- Eliminates duplicated form formatting logic between `CollectionFormView` and `GlobalFormView`.
- Ensures API consumers sending offset-less date strings are safely interpreted as UTC.
