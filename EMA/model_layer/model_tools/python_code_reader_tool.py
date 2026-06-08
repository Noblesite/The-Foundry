import ast
import os
from typing import List, Dict, Union

class PythonCodeReader:
    def __init__(self, directory: str = None):
        """
        Initialize the Python Code Reader.
        :param directory: Optional directory path to scan for Python files.
        """
        self.directory = directory if directory else os.getcwd()

    def read_file(self, file_path: str) -> str:
        """Read a Python file and return its content."""
        with open(file_path, "r", encoding="utf-8") as file:
            return file.read()

    def extract_definitions(self, file_path: str) -> Dict[str, List[Dict[str, Union[str, List[str]]]]]:
        """Extract function and class definitions with docstrings."""
        with open(file_path, "r", encoding="utf-8") as file:
            tree = ast.parse(file.read(), filename=file_path)

        functions = []
        classes = []

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                functions.append({
                    "name": node.name,
                    "args": [arg.arg for arg in node.args.args],
                    "docstring": ast.get_docstring(node, clean=True) or "No docstring"
                })
            elif isinstance(node, ast.ClassDef):
                methods = [
                    {
                        "name": method.name,
                        "args": [arg.arg for arg in method.args.args],
                        "docstring": ast.get_docstring(method, clean=True) or "No docstring"
                    }
                    for method in node.body if isinstance(method, ast.FunctionDef)
                ]
                classes.append({
                    "name": node.name,
                    "methods": methods,
                    "docstring": ast.get_docstring(node, clean=True) or "No docstring"
                })

        return {"functions": functions, "classes": classes}

    def search_files(self, keyword: str) -> List[str]:
        """Search for Python files in the given directory containing a keyword."""
        matches = []
        for root, _, files in os.walk(self.directory):
            for file in files:
                if file.endswith(".py"):
                    file_path = os.path.join(root, file)
                    with open(file_path, "r", encoding="utf-8") as f:
                        if keyword in f.read():
                            matches.append(file_path)
        return matches

    def scan_directory(self) -> Dict[str, Dict[str, List[Dict[str, Union[str, List[str]]]]]]:
        """Scan the directory for Python files and extract definitions."""
        results = {}
        for root, _, files in os.walk(self.directory):
            for file in files:
                if file.endswith(".py"):
                    file_path = os.path.join(root, file)
                    results[file_path] = self.extract_definitions(file_path)
        return results


if __name__ == "__main__":
    reader = PythonCodeReader(directory="./your_python_project")
    
    # Read a file
    file_content = reader.read_file("./your_python_project/example.py")
    print("File Content:\n", file_content)
    
    # Extract definitions
    definitions = reader.extract_definitions("./your_python_project/example.py")
    print("Extracted Definitions:\n", definitions)
    
    # Search for keyword in Python files
    matched_files = reader.search_files("def")
    print("Files containing 'def':\n", matched_files)

    # Scan an entire directory
    scanned_results = reader.scan_directory()
    print("Scanned Directory Results:\n", scanned_results)