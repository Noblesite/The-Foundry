import os
from pathlib import Path

def list_project_files(project_root, file_types=None):
    """
    List all files in the project directory with optional filtering by file types.
    :param project_root: Root directory of the project.
    :param file_types: List of file extensions to include (e.g., ['.py', '.yaml']).
    :return: List of file paths.
    """
    project_files = []
    for root, dirs, files in os.walk(project_root):
        for file in files:
            if not file_types or any(file.endswith(ext) for ext in file_types):
                file_path = Path(root) / file
                project_files.append(file_path)
    return project_files

if __name__ == "__main__":
    # Replace this path with the root directory of your project
    PROJECT_ROOT = ".."
    FILE_TYPES = ['.py', '.yaml', '.jsonl']  # Adjust as needed

    print(f"Scanning project directory: {PROJECT_ROOT}")
    project_files = list_project_files(PROJECT_ROOT, FILE_TYPES)

    for file_path in project_files:
        print(f"{file_path} - {os.path.getsize(file_path)} bytes")

    print(f"✅ Found {len(project_files)} files in the project.")