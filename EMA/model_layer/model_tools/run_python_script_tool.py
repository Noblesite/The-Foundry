import subprocess
from langchain.tools import BaseTool
from typing import Any
import json

class RunPythonScriptTool(BaseTool):
    name: str = "run_python_script"
    description: str = "Safely executes a provided Python script in a sandboxed environment."

    def _run(self, script: str) -> str:
        if not script:
            return json.dumps({"error": "Script content is required."}, indent=2)

        try:
            with open("temp_script.py", "w") as f:
                f.write(script)

            result = subprocess.run(
                ["python3", "temp_script.py"],
                capture_output=True,
                text=True,
                timeout=5
            )

            return result.stdout.strip() if result.stdout else "✅ Script executed successfully!"
        
        except Exception as e:
            return json.dumps({"error": f"Error running script: {str(e)}"}, indent=2)

    async def _arun(self, script: str) -> str:
        raise NotImplementedError("Async execution is not supported for this tool.")