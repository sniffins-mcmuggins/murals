# Task 8: Wire Routes + OpenAPI

**Files:**
- Modify: `api/cmd/api/main.go` — add festival import + 13 new routes
- Modify: `openapi/openapi.yaml` — add festival tag, schemas, and path entries

**Context:** Follow the pattern in main.go. Import path will be `github.com/sniffins-mcmuggins/render/api/internal/festival`. All festival handlers take `pool *pgxpool.Pool`. The OpenAPI spec already has a `Conflict` response schema (check before adding). Route params use `{festivalID}`, `{slug}`, `{applicationID}`.

---

- [ ] **Step 1: Add festival routes to main.go**

In `api/cmd/api/main.go`, add the import:
```go
"github.com/sniffins-mcmuggins/render/api/internal/festival"
```

After the collections block, add:

```go
// Festivals
r.Post("/festivals", festival.CreateHandler(pool))
r.Get("/festivals", festival.ListHandler(pool))
r.Get("/festivals/{festivalID}", festival.GetHandler(pool))
r.Patch("/festivals/{festivalID}", festival.UpdateHandler(pool))
r.Delete("/festivals/{festivalID}", festival.DeleteHandler(pool))

// Application forms
r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(pool))
r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(pool))

// Applications
r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(pool))

// Review
r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(pool))
r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(pool))
r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(pool))

// Map
r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(pool))
```

**Important:** The static route `GET /festivals/slug/{slug}/map` must be registered BEFORE the parameterized `GET /festivals/{festivalID}` if chi uses first-match, OR register it as a separate prefix. With chi, static segments beat wildcards, so the order above is safe.

- [ ] **Step 2: Verify the API compiles**

```bash
cd api && go build ./cmd/api/...
```

Expected: no errors.

- [ ] **Step 3: Add festival entries to openapi/openapi.yaml**

Add `festival` to the tags list:
```yaml
  - name: festival
    description: Festival creation, management, applications, and map data
```

Add schemas to `components/schemas`:

```yaml
    FestivalStatus:
      type: string
      enum: [draft, open, live, archived]

    Festival:
      type: object
      properties:
        id:
          type: string
          format: uuid
        organiser_id:
          type: string
          format: uuid
        name:
          type: string
        slug:
          type: string
        description:
          type: string
        location_label:
          type: string
        start_date:
          type: string
          format: date
          nullable: true
        end_date:
          type: string
          format: date
          nullable: true
        status:
          $ref: '#/components/schemas/FestivalStatus'
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time

    ApplicationForm:
      type: object
      properties:
        id:
          type: string
          format: uuid
        festival_id:
          type: string
          format: uuid
        fields:
          type: array
          items:
            type: object
        open_at:
          type: string
          format: date-time
          nullable: true
        close_at:
          type: string
          format: date-time
          nullable: true
        max_applications:
          type: integer
          nullable: true
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time

    ApplicationStatus:
      type: string
      enum: [submitted, accepted, declined]

    Application:
      type: object
      properties:
        id:
          type: string
          format: uuid
        form_id:
          type: string
          format: uuid
        artist_id:
          type: string
          format: uuid
        status:
          $ref: '#/components/schemas/ApplicationStatus'
        answers:
          type: object
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time

    MapPin:
      type: object
      properties:
        artist_id:
          type: string
          format: uuid
          description: Artist profile UUID
        name:
          type: string
        lat:
          type: number
          format: float
        lng:
          type: number
          format: float
        w3w:
          type: string
          nullable: true

    MapData:
      type: object
      properties:
        pins:
          type: array
          items:
            $ref: '#/components/schemas/MapPin'
```

Add paths (add these to the `paths:` section):

```yaml
  /festivals:
    post:
      tags: [festival]
      summary: Create a festival
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, slug]
              properties:
                name:
                  type: string
                slug:
                  type: string
                description:
                  type: string
                locationLabel:
                  type: string
                startDate:
                  type: string
                  format: date
                endDate:
                  type: string
                  format: date
      responses:
        '201':
          description: Festival created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Festival'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/Conflict'
    get:
      tags: [festival]
      summary: List my festivals
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of festivals
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Festival'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /festivals/{festivalID}:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      tags: [festival]
      summary: Get a festival by ID
      responses:
        '200':
          description: Festival
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Festival'
        '404':
          $ref: '#/components/responses/NotFound'
    patch:
      tags: [festival]
      summary: Update a festival
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                slug:
                  type: string
                description:
                  type: string
                locationLabel:
                  type: string
                status:
                  $ref: '#/components/schemas/FestivalStatus'
      responses:
        '200':
          description: Updated festival
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Festival'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
    delete:
      tags: [festival]
      summary: Delete a festival (soft delete)
      security:
        - bearerAuth: []
      responses:
        '204':
          description: Deleted
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'

  /festivals/{festivalID}/form:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    put:
      tags: [festival]
      summary: Upsert application form
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                fields:
                  type: array
                  items:
                    type: object
      responses:
        '200':
          description: Application form
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApplicationForm'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
    get:
      tags: [festival]
      summary: Get application form
      responses:
        '200':
          description: Application form
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApplicationForm'
        '404':
          $ref: '#/components/responses/NotFound'

  /festivals/{festivalID}/apply:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      tags: [festival]
      summary: Submit an application
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [answers]
              properties:
                answers:
                  type: object
      responses:
        '201':
          description: Application submitted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Application'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          $ref: '#/components/responses/Conflict'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'

  /festivals/{festivalID}/applications:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      tags: [festival]
      summary: List applications for a festival
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of applications
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Application'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'

  /festivals/{festivalID}/applications/{applicationID}/accept:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: applicationID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      tags: [festival]
      summary: Accept an application
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Updated application
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Application'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'

  /festivals/{festivalID}/applications/{applicationID}/decline:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: applicationID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    post:
      tags: [festival]
      summary: Decline an application
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Updated application
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Application'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'

  /festivals/slug/{slug}/map:
    parameters:
      - name: slug
        in: path
        required: true
        schema:
          type: string
    get:
      tags: [festival]
      summary: Get festival map data (public, live festivals only)
      responses:
        '200':
          description: Map data with accepted artist pins
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MapData'
        '404':
          $ref: '#/components/responses/NotFound'
```

Check if the openapi.yaml already has `Conflict` and `UnprocessableEntity` response refs. If not, add them to `components/responses`:

```yaml
    Conflict:
      description: Conflict
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    UnprocessableEntity:
      description: Unprocessable Entity
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
```

- [ ] **Step 4: Validate OpenAPI**

```bash
task openapi:lint
```

Or if that doesn't exist:
```bash
cd openapi && npx @redocly/cli lint openapi.yaml 2>&1 | tail -20
```

Fix any validation errors before proceeding.

- [ ] **Step 5: Commit**

```bash
git add api/cmd/api/main.go openapi/openapi.yaml
git commit -m "feat(festival): wire festival routes and update OpenAPI spec"
```
