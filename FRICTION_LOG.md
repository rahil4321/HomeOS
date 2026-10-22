# Friction Log — HomeOS

## Task attempted
Integrate Amazon Bedrock into HomeOS for AI-powered semantic interruption classification.

## Steps taken
Attempted to configure the Bedrock integration and troubleshoot validation and dependency/import issues during setup.

## Expected result
HomeOS would use Amazon Bedrock to classify incoming events into three categories: `INTERRUPT`, `VISUAL_ONLY`, and `IGNORE`.

## Actual result
The integration could not be completed successfully because of unresolved setup and compatibility errors. Amazon Bedrock was not part of the working inference path in the submitted implementation.

## Severity
**High** — the issue prevented completion of the intended AWS integration.

## Workaround
Retained the existing working AI classification path so the core HomeOS event-routing workflow could still be demonstrated.

## Suggested improvement
Provide a tested end-to-end Bedrock integration guide, explicit SDK compatibility information, and clearer diagnostics for validation and initialization failures.

## Impact
The experience highlighted the importance of dependency compatibility, integration testing, and actionable error reporting when incorporating cloud AI services into an application.
