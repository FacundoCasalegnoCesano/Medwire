const API_BASE = "http://127.0.0.1:3000";

export async function fetchDemoWidgets() {
  const response = await fetch(API_BASE + "/api/demo/widgets");
  if (!response.ok) throw new Error(`Demo API returned ${response.status}`);
  return response.json();
}
