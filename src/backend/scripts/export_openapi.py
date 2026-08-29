"""Export OpenAPI spec from FastAPI app.

Run inside the backend container:
    podman exec creditcardanalyzer_backend_dev_1 python /app/scripts/export_openapi.py
"""
import sys
import os
import yaml

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from main import app

spec = app.openapi()
output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "specs", "openapi.yaml")
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, "w") as f:
    yaml.dump(spec, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

print(f"OpenAPI spec exported to {output_path}")
print(f"Paths: {len(spec.get('paths', {}))}")
print(f"Schemas: {len(spec.get('components', {}).get('schemas', {}))}")
