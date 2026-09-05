# Codex task: update the EOS meeting-recap Functions worker

Copy this document into the Codex task for the separate Azure Functions app
that handles Bremmar `type: "meeting-summary"` jobs. The goal is to update the
worker implementation, its runtime prompt, its JSON validation, and its tests
so the web application receives useful, safe, name-based meeting recaps.

This task is about the worker and its contract. Inspect the Functions
repository before editing; do not assume its folder names, framework, model
provider, or current prompt location.

## Goal

Generate a concise, factual EOS Level 10 recap from the immutable close-time
meeting snapshot.

The recap must:

- use participant names instead of facilitator or attendee GUIDs;
- preserve the distinction between Rocks, To-Dos, Issues, Scorecard
  measurables, Headlines, and IDS decisions;
- include useful highlights, decisions, commitments, risks, and next focus;
- include exact individual meeting ratings and a deterministic overall rating;
- remain safe for legacy snapshots that do not contain named participant
  fields; and
- return strict JSON that the signed callback consumer can validate.

## Integration contract

The host application sends a signed POST similar to this:

```json
{
  "type": "meeting-summary",
  "jobId": "internal-job-id",
  "meetingId": "internal-meeting-id",
  "teamId": "internal-team-id",
  "environmentId": "live",
  "attempt": 1,
  "source": "close",
  "callbackUrl": "https://host.example/api/internal/meeting-summary-callback",
  "context": {
    "meetingId": "internal-meeting-id",
    "teamId": "internal-team-id",
    "label": "Leadership L10",
    "scheduledDate": "2026-09-05",
    "scheduledTime": "9:00 AM",
    "facilitatorId": "internal-user-id",
    "facilitatorName": "Ava Khan",
    "attendeeIds": ["internal-user-id", "internal-user-id-2"],
    "attendees": [
      { "id": "internal-user-id", "name": "Ava Khan", "rating": 8.5 },
      { "id": "internal-user-id-2", "name": "Marcus Lee", "rating": 7 }
    ],
    "attendeeRatings": [
      { "attendeeId": "internal-user-id", "rating": 8.5 },
      { "attendeeId": "internal-user-id-2", "rating": 7 }
    ],
    "manualRecap": "The facilitator-entered closing recap.",
    "recap": "The complete close-time meeting record snapshot.",
    "sectionNotes": {
      "ids": "The team solved the onboarding issue and assigned a follow-up."
    },
    "idsNotes": [],
    "actionSummary": {
      "todosCreated": 1,
      "issuesReviewedInIds": 2,
      "issuesAddedToIds": 0,
      "issuesSolved": 1
    },
    "rocks": [],
    "todos": [],
    "issues": [],
    "headlines": [],
    "scorecard": []
  }
}
```

The transport envelope necessarily contains internal IDs for correlation. IDs
must never appear in the user-visible `summary`, generated prose, logs, or
error messages.

New jobs contain `facilitatorName`, `attendees[].name`, and `manualRecap`.
Older queued jobs may not contain them. The worker must accept both shapes and
use readable text in `recap` as a fallback where possible. If a participant
cannot be resolved, use `Unknown participant`; never fall back to printing the
ID.

## Required implementation changes

### 1. Preserve the existing secure job flow

- Keep verification of the inbound HMAC/signature, timestamp, environment, and
  job shape.
- Use only the immutable `context` snapshot for generation. Do not make live
  cross-team queries while producing the recap.
- Preserve `jobId`, `attempt`, `environmentId`, and `source` in the callback.
- Sign the callback using the existing protocol and callback secret.
- Make retries idempotent. A terminal callback must not be sent twice for the
  same job attempt.
- Keep failed-callback messages short and safe. Do not include secrets,
  prompts, raw headers, request bodies, or internal IDs.
- Do not weaken authentication or add an unauthenticated fallback endpoint.

### 2. Resolve names before the model sees user-facing context

Build a participant lookup from `context.attendees` and
`context.facilitatorName`.

The model may use `id` values only for internal correlation while processing
the input. The prompt and output validator must make clear that IDs are not
valid user-facing content. Before posting the callback, scan every generated
string and reject or replace any known participant, meeting, team, Rock,
To-Do, or Issue IDs that appear in prose.

Do not expose an unresolved ID in a fallback, validation error, or log line.

### 3. Treat the manual recap as first-class context

Pass `context.manualRecap` to the model as the facilitator's closing words.
Use it as supporting context, but do not treat it as proof of a decision unless
the structured meeting record confirms that decision.

The worker must not replace structured records with a free-form manual recap.
The close-time snapshot is authoritative for attendees, ratings, section notes,
IDS notes, Rocks, To-Dos, Issues, Headlines, and Scorecard results.

### 4. Update the runtime system/developer prompt

Replace or update the worker's current meeting-summary prompt with the
following requirements. Keep the wording in source control near the worker so
future prompt changes are reviewable.

#### Required prompt text

You are generating a concise, factual recap of one EOS Level 10 meeting from a
close-time snapshot.

Use the L10 order when interpreting the snapshot:

1. Segue
2. Scorecard
3. Rock Review
4. Customer/Employee Headlines
5. To-Do Review
6. IDS
7. Conclude

Follow these rules:

1. Use participant display names in all prose. Prefer
   `facilitatorName` and `attendees[].name` over any ID field.
2. Never output a GUID, Entra object ID, internal user ID, meeting ID, team ID,
   Rock ID, To-Do ID, Issue ID, database key, or any other opaque identifier.
   This applies to prose, arrays, fallback text, and error text. If a name is
   unavailable, write `Unknown participant`.
3. Treat `manualRecap` as the facilitator's own closing words. Use it as
   context, not as proof of a decision unless the structured record confirms
   the decision.
4. A Rock is a quarterly priority. A To-Do is an owned commitment intended for
   the next seven days. An Issue is an unresolved problem, decision, or
   opportunity. Never convert an open Issue into a commitment without an
   explicit recorded To-Do.
5. Report only evidence in the snapshot. Do not guess owners, due dates,
   outcomes, sentiment, customer impact, or causes. Preserve open, parked,
   off-track, not-entered, and carried-forward states.
6. Give IDS notes and explicit meeting decisions priority over general
   discussion.
7. Put unresolved follow-up in `risks` or `nextFocus`, not `decisions`.
8. Put a To-Do in `commitments` only when it was created or explicitly
   confirmed in the snapshot.
9. Use `highlights` for verified wins, progress, or meaningful positive
   outcomes from Headlines, Scorecard, Rocks, To-Dos, or IDS.
10. Use `ratingInsight` only for a cautious factual observation about the
    recorded rating distribution. Do not infer why people gave a rating or
    assign sentiment to a person.
11. Keep all strings concise plain text. Do not return Markdown, HTML, tables,
    headings, or commentary outside the JSON object.
12. Empty sections must be empty arrays. Do not add filler such as `Nothing to
    report.`

The model must return only the model-response JSON described below. It must
not return Markdown fences or explanatory text.

## JSON output requirements

There are two layers: the model response and the final signed callback
summary. Keep them separate so exact ratings are copied from the snapshot
rather than invented by the model.

### Model response

The model must return exactly this shape, with no additional properties:

```json
{
  "executiveSummary": "Two or three concise sentences describing the most important outcome and next action.",
  "highlights": [
    "A verified win or meaningful progress item."
  ],
  "decisions": [
    "Only explicit decisions recorded in IDS or the meeting notes."
  ],
  "commitments": [
    "Only To-Dos created or explicitly confirmed in the meeting. Include a named owner or due date only when recorded."
  ],
  "risks": [
    "Off-track Rocks, off-track Scorecard results, open Issues, or explicit concerns."
  ],
  "nextFocus": [
    "The highest-value follow-up conversation or commitment for the next meeting window."
  ],
  "ratingInsight": "A short evidence-based observation about the rating distribution, or null when there are no ratings."
}
```

Validation rules for the model response:

- `executiveSummary` is a non-empty string and no more than 600 characters.
- `highlights`, `decisions`, `commitments`, `risks`, and `nextFocus` are arrays
  of non-empty strings. Use at most eight items per array and keep each item
  concise.
- `ratingInsight` is either `null` or a non-empty plain-text string.
- Reject Markdown fences, HTML, non-JSON output, missing required properties,
  wrong types, empty strings, or unexpected properties.
- Never trust model-generated names or ratings when the same data exists in
  the signed context snapshot.

### Deterministic rating enrichment

After validating the model response, construct `ratingSummary` in worker code
from the snapshot. Do not ask the model to calculate or restate these values.

```json
{
  "overall": 7.75,
  "individual": [
    { "name": "Ava Khan", "rating": 8.5 },
    { "name": "Marcus Lee", "rating": 7 }
  ]
}
```

Rules:

- Use the exact recorded rating values; preserve half-points such as `8.5`.
- Accept only finite ratings from `0.5` through `10` in `0.5` increments.
- Resolve each `attendeeId` through `attendees[].id` and use the corresponding
  `name`. If no name is available, use `Unknown participant`.
- Include only recorded ratings. If there are no valid ratings, return
  `"overall": null` and `"individual": []`.
- Calculate `overall` as the arithmetic mean of valid ratings, rounded to two
  decimal places using the same rule as the host application.
- Deduplicate by the recorded attendee identity before calculating the mean.
- `ratingSummary` must contain no IDs.

### Final ready callback summary

The final callback's `summary` must preserve the existing fields and add the
new structured fields:

```json
{
  "executiveSummary": "The team resolved the onboarding issue and left with one owned follow-up.",
  "highlights": [
    "The onboarding issue was solved during IDS."
  ],
  "decisions": [
    "Use the revised onboarding checklist for the next client launch."
  ],
  "commitments": [
    "Ava Khan will publish the revised checklist by 2026-09-12."
  ],
  "risks": [],
  "nextFocus": [
    "Confirm adoption of the revised checklist at the next L10."
  ],
  "ratingInsight": "The recorded ratings were positive and differed by 1.5 points.",
  "ratingSummary": {
    "overall": 7.75,
    "individual": [
      { "name": "Ava Khan", "rating": 8.5 },
      { "name": "Marcus Lee", "rating": 7 }
    ]
  },
  "generatedAt": "2026-09-05T12:00:00.000Z",
  "source": "close"
}
```

The final callback envelope remains compatible with the host integration:

```json
{
  "environmentId": "live",
  "jobId": "internal-job-id",
  "attempt": 1,
  "status": "ready",
  "summary": {}
}
```

For a failure, send the existing signed shape with `status: "failed"`, a safe
short `error`, and no `summary`. Do not put internal IDs in `error`.

If the host API has a typed summary interface or strict schema, update that
consumer in the same change to accept `highlights`, `ratingInsight`, and
`ratingSummary`. Preserve backward compatibility with older summaries that do
not contain the new fields. If the host API cannot be changed in this worker
task, document the contract change clearly and do not remove any existing
fields.

## Suggested generation pipeline

1. Verify the signed request and validate the required envelope fields.
2. Validate and normalize the context without changing its meaning.
3. Build a model input that includes names, manual recap, section notes, IDS
   notes, action summary, Rocks, To-Dos, Issues, Headlines, and Scorecard
   data.
4. Request the model response using the revised system/developer prompt.
5. Parse strict JSON and validate the model response against the exact schema.
6. Scan every user-visible string for known opaque IDs and reject or safely
   replace them before continuing.
7. Construct deterministic `ratingSummary` from the signed context.
8. Set `generatedAt` in the worker to the current ISO timestamp and copy
   `source` from the job; do not rely on model-supplied metadata.
9. Post the signed, idempotent ready callback.
10. On any failure, post one safe failed callback and preserve retry semantics.

## Tests to add or update

Add tests in the Functions repository for all of the following:

- `facilitatorName: "Ava Khan"` is used in output and its GUID is absent from
  every user-visible field.
- Named attendees appear in `ratingSummary.individual`.
- Ratings such as `8.5` remain exactly `8.5`.
- The deterministic overall rating is the arithmetic average rounded to two
  decimals.
- No ratings produce `overall: null` and an empty `individual` array.
- A legacy snapshot without `facilitatorName` or `attendees[].name` completes
  safely without exposing an ID.
- Manual recap is used as supporting context but cannot create an unsupported
  decision or To-Do.
- Open Issues are not silently converted into commitments.
- Off-track Rocks and Scorecard results are surfaced as risks when supported by
  the snapshot.
- Invalid model JSON, missing arrays, extra properties, Markdown fences, and
  ID leakage are rejected safely.
- The callback includes the original `jobId`, `attempt`, `environmentId`, and
  `source` semantics.
- Invalid signatures, stale timestamps, wrong attempts, duplicate terminal
  callbacks, and failure callbacks remain covered.

## Definition of done

- The worker implementation, runtime prompt, output types/schema, and tests are
  updated together.
- The ready callback contains the new structured fields without removing the
  existing recap sections.
- The worker never exposes opaque IDs in generated text or safe error output.
- Individual ratings are copied from the close-time snapshot and are never
  invented by the model.
- Legacy jobs continue to complete safely.
- The repository's formatting, lint, type-check, build, and test commands pass
  with finite timeouts.
- Documentation identifies the updated prompt and JSON contract.
