Manual QA fixture (needs the Python extension / Pylance).

Expected in Language Server mode:
- `MeterService`: 0 in file | 2 in project (import + call in views.py; venv/ excluded)
- `calculate_consumption`: 1 in file | 2 in project
- `summary`: 0 | 0
- `unused_function`: 0 | 0
- `__init__`: no lens (dunder)

In Text mode `calculate_consumption` also counts `templates/meter.html` → 1 | 3.
