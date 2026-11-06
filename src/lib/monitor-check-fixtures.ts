export const openApi30Json = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Widgets API", version: "1.0.0", description: "Initial description." },
  servers: [{ url: "https://api.example.test" }],
  paths: {
    "/widgets": {
      get: {
        operationId: "listWidgets",
        responses: { "200": { description: "List of widgets." } },
      },
      post: {
        operationId: "createWidget",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWidget" } } },
        },
        responses: { "201": { description: "Created." } },
      },
    },
    "/widgets/{widgetId}": {
      get: {
        operationId: "getWidget",
        parameters: [{ name: "widgetId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "A widget." } },
      },
    },
  },
  components: {
    schemas: {
      CreateWidget: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
});

const openApi30EndpointRemoved = JSON.parse(openApi30Json) as {
  paths: Record<string, Record<string, unknown>>;
};
delete openApi30EndpointRemoved.paths["/widgets"].get;
export const openApi30EndpointRemovedJson = JSON.stringify(openApi30EndpointRemoved);

export const openApi31CompatibleYaml = `openapi: 3.1.0
info:
  title: Widgets API
  version: 1.0.1
  description: Initial description.
servers:
  - url: https://api.example.test
paths:
  /widgets/{widgetId}:
    get:
      operationId: getWidget
      parameters:
        - name: widgetId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: A widget.
  /widgets:
    post:
      operationId: createWidget
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateWidget'
      responses:
        '201':
          description: Created.
  /health:
    get:
      operationId: getHealth
      responses:
        '200':
          description: Service health.
components:
  schemas:
    CreateWidget:
      type: object
      required:
        - name
      properties:
        name:
          type: string
        color:
          type: string
`;

export const openApi31DescriptionOnlyYaml = openApi31CompatibleYaml.replace(
  "Initial description.",
  "A revised description that does not change the contract.",
);

export const openApi31RequiredPropertyYaml = openApi31DescriptionOnlyYaml.replace(
  "      required:\n        - name\n",
  "      required:\n        - name\n        - color\n",
);
