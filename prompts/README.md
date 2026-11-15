# EHBR AI-Assisted Development Guide

This README explains what should be prepared, connected, checked, and
understood **before using the prompts in this project** with an AI
assistant such as Claude or ChatGPT.

The goal is to make AI-assisted work on the Emergency Hub Barangay Rizal
(EHBR) project safer, more consistent, and grounded in the actual Figma
designs and source code.

> **Important:** Connecting GitHub or Figma does not automatically mean
> the assistant can inspect every file, page, frame, branch, or project
> setting. Always verify the access available in the specific
> conversation before relying on it.

------------------------------------------------------------------------

## 1. Prompt library

The `prompts/` directory contains the following prompt files:

  -------------------------------------------------------------------------------------------------------------------
  No.                     Prompt file                                                         Intended purpose
  ----------------------- ------------------------------------------------------------------- -----------------------
  01                      `01. EHBR_GitHub_Audit_Repository_Analysis.md`                      Read-only inspection of
                                                                                              the repository, its
                                                                                              structure,
                                                                                              technologies,
                                                                                              dependencies, code,
                                                                                              configuration, backend,
                                                                                              and database.

  02                      `02. EHBR_Figma_Design_Audit_UIUX_Analysis.md`                      Read-only analysis of
                                                                                              the Figma design,
                                                                                              screens, components,
                                                                                              navigation,
                                                                                              interactions, and user
                                                                                              flows.

  03                      `03. EHBR_Design_To_Code_Audit.md`                                  Comparison of Figma
                                                                                              requirements against
                                                                                              the actual MAM, WAM,
                                                                                              backend, and database
                                                                                              implementation.

  04                      `04. EHBR_Development_&_Implementation_Workspace.md`                Main development
                                                                                              coordination workspace
                                                                                              for planning and
                                                                                              implementing approved
                                                                                              EHBR changes.

  05                      `05. EHBR_MAM_Mobile_UIUX_Replication_&_Implementation.md`          Resident mobile
                                                                                              application development
                                                                                              using Flutter and Dart.

  06                      `06. EHBR_WAM_Web_UIUX_Replication_&_Implementation.md`             Admin web application
                                                                                              UI, functionality, and
                                                                                              responsive development.

  07                      `07. EHBR_Backend_API_&_Database_Replication_&_Implementation.md`   Backend APIs,
                                                                                              authentication,
                                                                                              business logic,
                                                                                              database, security, and
                                                                                              integration.
  -------------------------------------------------------------------------------------------------------------------

Use the actual filenames in the repository if they differ from this
table. Prompt filenames and contents may evolve as the project develops.

------------------------------------------------------------------------

## 2. Prepare the project before connecting an AI assistant

### 2.1 Confirm the GitHub repository

Repository:

<https://github.com/Rai567245/EHBR-Emegency-Hub-Barangay-Rizal>

Before starting an audit or development task:

-   Confirm that this is the correct repository.
-   Confirm which branch is the current development baseline, normally
    `main` unless the project uses another agreed branch.
-   Check that the latest work has been committed or backed up.
-   Check the working tree for uncommitted changes before allowing an AI
    coding tool to edit files.
-   Do not assume the remote repository contains the latest work from
    your local computer.
-   Do not let an assistant overwrite changes that have not been
    committed or otherwise backed up.

Recommended repository areas to inspect:

-   `app/` --- resident mobile application (MAM).
-   `admin/` --- admin web application (WAM).
-   `server/` --- backend and API services.
-   Root-level documentation and configuration.
-   Database schemas, migrations, models, and related files, wherever
    they actually exist.
-   `prompts/` --- AI-assisted audit and development prompts.

The repository structure must be discovered from the actual repository.
The list above describes the known project areas; it is not a guarantee
that every expected file or subdirectory exists.

### 2.2 Confirm the Figma design file

Use the approved EHBR Figma design as the design reference.

Figma: 

<https://www.figma.com/design/u5Q8OUeEVo8fVRbEV9OfKh/EHBR--Emergency-Hub-Barangay-Rizal----UI-UX-Prototype?node-id=4-305&p=f&t=tvFcRq2X4YmCX2GC-0>

Before asking an assistant to audit it:

-   Confirm that the Figma file opens in your account.
-   Confirm that it is the correct EHBR project and not an outdated
    duplicate.
-   Identify the MAM and WAM pages or sections.
-   Confirm that important frames, components, prototypes, and
    interactions are accessible.
-   Keep the Figma file key and relevant links available.
-   Identify which designs are approved and which are drafts or
    experiments.

Figma is the reference for intended design and user experience. It is
**not proof that a feature already exists in the codebase**.

### 2.3 Prepare the audit reports

The development prompts refer to these reports:

1.  `EHBR_GITHUB_AUDIT.md`
2.  `EHBR_FIGMA_DESIGN_AUDIT.md`
3.  `EHBR_DESIGN_TO_CODE_ROADMAP.md`

Make sure the latest completed copies are available to the assistant
that will use them.

You can provide them through an appropriate project knowledge or
file-upload feature, or keep them in the repository and verify that the
assistant can access them through its connected tools.

Do not assume that a report is accessible just because its filename
appears in a prompt.

If a report has not been generated yet, complete the corresponding audit
first. If a report is outdated, label it as outdated and ask the
assistant to verify relevant findings against the current source.

------------------------------------------------------------------------

## 3. Connect the required tools and sources

The exact connection process depends on the AI assistant, account, plan,
enabled integrations, and current product support. Follow the
assistant's current connection instructions rather than assuming every
account has the same features.

### 3.1 GitHub connection

Connect the GitHub account or repository using the assistant's supported
GitHub integration, connector, or coding environment.

Verify that the assistant can:

-   Identify the correct EHBR repository.
-   Read the repository's root directory.
-   Browse the `app/`, `admin/`, and `server/` areas.
-   Open relevant source files.
-   Follow imports, routes, API calls, models, and configuration
    references.
-   Identify the branch or revision it is inspecting, where the
    integration exposes that information.

For an initial audit, **read-only access is preferred**.

For implementation, use a controlled coding workflow with an appropriate
working branch and review changes before accepting them. Grant write
access only when it is necessary and understood.

A connected repository card or successful repository lookup is not
sufficient proof that the assistant can inspect the entire repository.
Ask it to list the paths it actually accessed and disclose inaccessible
areas.

### 3.2 Figma connection

Connect Figma through the assistant's supported Figma integration, MCP
server, or other approved method.

Verify that the assistant can:

-   Open the correct EHBR Figma file.
-   Identify the MAM and WAM pages.
-   Inspect frame names and dimensions.
-   Inspect relevant components and variants.
-   Read design properties and shared styles or variables when
    available.
-   Inspect prototype connections and interaction destinations when
    available.
-   Identify inaccessible pages, frames, or assets.

If the assistant cannot access Figma directly, provide the smallest
useful alternative: the Figma link, screenshots of the relevant frame,
exported assets, or a design specification. Clearly label the limits of
that evidence.

Do not treat a screenshot as proof of prototype behavior or hidden
component properties.

### 3.3 Local coding environment

For code implementation, prepare a local development environment and
confirm that the project can be inspected and tested independently of
the AI assistant.

Depending on the actual project configuration, this may include:

-   A suitable code editor such as Visual Studio Code.
-   Git and access to the correct repository.
-   Flutter SDK and Dart tooling for MAM.
-   Node.js and the package manager required by the repository for WAM
    and the server.
-   The configured database service, if required.
-   Android SDK and an emulator or physical device for Android testing.
-   iOS development tools if iOS builds are required and available.
-   Required environment variables and local configuration.

Use the repository's own README files, package manifests, lockfiles, and
setup documentation to determine exact versions and commands. Do not
guess versions or install dependencies simply because an AI assistant
recommends them.

### 3.4 Verify access in the actual conversation

Before using a long audit or development prompt, ask the assistant to
confirm:

1.  Which GitHub repository and branch or revision it can access.
2.  Which directories and files it successfully inspected.
3.  Whether it can access the intended Figma file.
4.  Which Figma pages, frames, and components it inspected.
5.  Which audit reports and project documents it can read.
6.  What it cannot access or verify.

Require an explicit limitations section. The assistant must not claim a
complete audit if access was partial.

------------------------------------------------------------------------

## 4. Recommended order for using the prompts

Follow this sequence for a new or substantially changed project
baseline.

### Phase 1 --- Repository audit

Run:

`01. EHBR_GitHub_Audit_Repository_Analysis.md`

Purpose:

-   Establish the actual repository structure.
-   Identify technologies, dependencies, and architecture.
-   Trace MAM, WAM, backend, and database implementation.
-   Inspect configuration, setup requirements, and security concerns.
-   Record what is implemented, incomplete, or unknown.

**Mode:** Read-only. Do not modify code, install dependencies, run
migrations, or change Git history during the initial audit.

Expected report:

`EHBR_GITHUB_AUDIT.md`

### Phase 2 --- Figma design audit

Run:

`02. EHBR_Figma_Design_Audit_UIUX_Analysis.md`

Purpose:

-   Inventory accessible MAM and WAM pages and frames.
-   Record intended screen layouts and interactions.
-   Examine navigation and prototype connections.
-   Identify design inconsistencies, missing states, and unclear flows.
-   Document the actual scope of Figma inspection.

**Mode:** Read-only. Do not modify the Figma file.

Expected report:

`EHBR_FIGMA_DESIGN_AUDIT.md`

### Phase 3 --- Design-to-code audit

Run:

`03. EHBR_Design_To_Code_Audit.md`

Purpose:

-   Compare the Figma design against the real repository implementation.
-   Trace important workflows through frontend, API, and database
    layers.
-   Identify visual and functional discrepancies separately.
-   Prioritize defects, missing functionality, dependencies, and testing
    needs.

Provide the completed repository and Figma audit reports to the
assistant. It must also verify important findings against accessible
current source files.

Expected report:

`EHBR_DESIGN_TO_CODE_ROADMAP.md`

### Phase 4 --- Main development workspace

Run:

`04. EHBR_Development_&_Implementation_Workspace.md`

Purpose:

-   Establish the development baseline.
-   Review the three audit reports.
-   Coordinate priorities across MAM, WAM, and backend.
-   Select manageable tasks and define acceptance criteria.
-   Keep a consistent project-wide roadmap.

Do not ask the assistant to implement every roadmap item at once. Start
with one approved task.

### Phase 5 --- Dedicated development workspaces

Create separate conversations for focused work:

  -----------------------------------------------------------------------
  Prompt                  Workspace               Scope
  ----------------------- ----------------------- -----------------------
  `05.`                   EHBR MAM --- Mobile UI  Flutter resident mobile
                          & Features              application.

  `06.`                   EHBR WAM --- Admin Web  Admin web application.
                          UI & Features           

  `07.`                   EHBR Backend --- API &  Backend, APIs, and
                          Database Development    database.
  -----------------------------------------------------------------------

These workspaces should use the same audit baseline and coordinate API
contracts and cross-application dependencies.

Do not let separate AI conversations edit the same files simultaneously
without coordination.

------------------------------------------------------------------------

## 5. Recommended workflow for each implementation task

Use a controlled development cycle.

1.  **Select one task.** Identify the feature, screen, defect, or
    roadmap item.
2.  **Inspect.** Read the relevant Figma frame, source files,
    dependencies, and existing behavior.
3.  **Compare.** Document the difference between intended behavior and
    actual implementation.
4.  **Plan.** List affected files, API or database dependencies, risks,
    and acceptance criteria.
5.  **Approve.** Review and explicitly approve the proposed changes.
6.  **Implement.** Make only the approved, focused changes.
7.  **Test.** Run appropriate automated tests, analysis, builds, and
    manual checks.
8.  **Review.** Inspect the diff and check for regressions.
9.  **Document.** Record files changed, test results, limitations, and
    the next task.
10. **Commit.** Commit only after reviewing and approving the changes.

For UI replication, use **one Figma frame per comparison and
implementation cycle** whenever practical. Finish and verify the current
frame before moving to the next one.

For cross-application features, coordinate the complete workflow. For
example, a report-status feature may require a backend contract, a WAM
administrative action, and an MAM resident-facing update.

------------------------------------------------------------------------

## 6. Project safety and access rules

Follow these rules regardless of which AI assistant or coding tool is
used.

### Source code and Git

-   Keep a recoverable copy of important work.
-   Use feature branches for development where practical.
-   Review `git status` and diffs before and after AI-assisted edits.
-   Do not allow an assistant to discard or overwrite unrelated changes.
-   Do not commit or push without your approval.
-   Do not merge unreviewed AI-generated changes into the main branch.

### Secrets and personal information

-   Never paste passwords, API keys, access tokens, private
    certificates, or production credentials into prompts.
-   Never commit `.env` files or other secret-bearing files.
-   Use local environment configuration and safe example files.
-   Redact resident personal information, phone numbers, precise
    locations, and other sensitive records from screenshots, logs, and
    test data.
-   Do not ask an assistant to print secret values while auditing
    configuration.

### Database and emergency workflows

-   Do not run destructive database operations without explicit review
    and approval.
-   Use an isolated test database for automated tests.
-   Back up data before approved schema or data changes.
-   Treat SOS, emergency reporting, location sharing, notifications, and
    responder acknowledgment as safety-critical.
-   Never claim an emergency alert was delivered unless the system
    provides evidence of delivery or acknowledgment.
-   Verify failure handling, duplicate submissions, authorization, and
    persistence.

### AI-generated changes

-   AI output must be reviewed.
-   Code existence is not proof that a feature works.
-   A successful build is not proof that an end-to-end workflow works.
-   Distinguish static inspection, automated test results, and real
    device or browser verification.
-   Keep a record of unverified assumptions and blockers.

------------------------------------------------------------------------

## 7. Suggested project instruction for AI assistants

You can use the following short instruction in an assistant's
project-level instructions, where supported:

> You are assisting with the EHBR project. Treat the connected GitHub
> repository as the source of truth for actual implementation, the
> approved Figma file as the source of truth for intended design, and
> the available audit reports as the initial analysis baseline. Verify
> access before making claims. Never invent file paths, endpoints,
> schemas, frame names, or implemented behavior. Disclose limitations
> and distinguish observed evidence, inference, unknowns, and
> recommendations. Begin with read-only inspection. Before editing,
> inspect the relevant code, explain the proposed changes and affected
> files, and wait for approval. Preserve existing architecture and
> unrelated work. Never expose secrets or perform destructive operations
> without approval. Test changes and report actual results.

------------------------------------------------------------------------

## 8. Pre-flight checklist

Complete this checklist before starting the audit prompts.

### Project and source access

-   [ ] Correct EHBR GitHub repository confirmed.
-   [ ] Correct branch or development baseline identified.
-   [ ] Latest local changes committed or backed up.
-   [ ] `app/`, `admin/`, and `server/` locations confirmed from the
    repository.
-   [ ] Repository documentation and configuration available.

### Figma access

-   [ ] Correct EHBR Figma file confirmed.
-   [ ] MAM pages and frames accessible.
-   [ ] WAM pages and frames accessible.
-   [ ] Relevant prototype interactions accessible.
-   [ ] Approved designs distinguished from drafts.

### AI assistant access

-   [ ] GitHub integration or coding environment connected.
-   [ ] Figma integration or MCP connection configured, if supported.
-   [ ] Assistant has verified access to the required sources.
-   [ ] Read-only access used for the initial audits.
-   [ ] Limitations and inaccessible content documented.

### Audit documents

-   [ ] `EHBR_GITHUB_AUDIT.md` available.
-   [ ] `EHBR_FIGMA_DESIGN_AUDIT.md` available.
-   [ ] `EHBR_DESIGN_TO_CODE_ROADMAP.md` available.
-   [ ] Report versions and dates are clear.
-   [ ] Development prompts can access the reports.

### Development safety

-   [ ] Local development environment is ready.
-   [ ] Required SDKs and runtimes verified against project
    configuration.
-   [ ] Test database and test data are isolated from production.
-   [ ] Secrets are excluded from prompts and repository commits.
-   [ ] Changes will be reviewed before commit or push.

------------------------------------------------------------------------

## 9. Suggested folder organization

Keep the prompt library and generated audit documents organized. For
example:

``` text
EHBR/
├── prompts/
│   ├── 01. EHBR_GitHub_Audit_Repository_Analysis.md
│   ├── 02. EHBR_Figma_Design_Audit_UIUX_Analysis.md
│   ├── 03. EHBR_Design_To_Code_Audit.md
│   ├── 04. EHBR_Development_&_Implementation_Workspace.md
│   ├── 05. EHBR_MAM_Mobile_UIUX_Replication_&_Implementation.md
│   ├── 06. EHBR_WAM_Web_UIUX_Replication_&_Implementation.md
│   └── 07. EHBR_Backend_API_&_Database_Replication_&_Implementation.md
├── docs/
│   ├── audits/
│   │   ├── EHBR_GITHUB_AUDIT.md
│   │   ├── EHBR_FIGMA_DESIGN_AUDIT.md
│   │   └── EHBR_DESIGN_TO_CODE_ROADMAP.md
│   └── development/
│       ├── EHBR_DEVELOPMENT_LOG.md
│       ├── EHBR_API_CONTRACTS.md
│       └── EHBR_TESTING_LOG.md
├── app/
├── admin/
└── server/
```

This is a suggested organization, not a statement that these folders
already exist. Confirm the current repository layout before creating or
moving files. Keep generated reports out of application source
directories unless the project has an established documentation
convention.

------------------------------------------------------------------------

## 10. Final recommended process

The recommended order is:

**Connect and verify sources → Run GitHub audit → Run Figma audit → Run
design-to-code audit → Review the roadmap → Start the main development
workspace → Use dedicated MAM, WAM, and Backend workspaces → Implement
one approved task at a time → Test and document → Review and commit.**

The purpose of this process is to ensure that AI-assisted development is
based on the actual EHBR project rather than assumptions.

**Final principle:** Figma defines what EHBR should look and behave
like. The repository defines what is actually implemented. The backend
and database define how information is processed and stored. Every
change must bring these parts closer together without compromising
security, reliability, or existing functionality.
