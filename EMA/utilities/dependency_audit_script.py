import subprocess
import json
import os

# Generate a list of installed packages and their licenses
def audit_dependencies(output_file="dependency_licenses.json"):
    try:
        # Run pip-licenses to get license information
        result = subprocess.run(
            ["pip-licenses", "--format=json", "--with-urls", "--with-authors"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        if result.returncode != 0:
            raise RuntimeError(f"Error running pip-licenses: {result.stderr.strip()}")

        # Parse the JSON output
        licenses = json.loads(result.stdout)

        # Save the output to a file
        with open(output_file, "w") as file:
            json.dump(licenses, file, indent=4)

        print(f"✅ Dependency audit saved to {output_file}")
    except FileNotFoundError:
        print("❌ pip-licenses is not installed. Install it using: pip install pip-licenses")
    except Exception as e:
        print(f"❌ An error occurred during the dependency audit: {e}")

# Display the dependencies and their licenses
def display_dependencies(file_path="dependency_licenses.json"):
    if not os.path.exists(file_path):
        print("❌ License file not found. Run the audit_dependencies function first.")
        return

    with open(file_path, "r") as file:
        licenses = json.load(file)

    print("\n📜 Installed Dependencies and Licenses:\n")
    for package in licenses:
        print(f"- Package: {package['Name']}")
        print(f"  Version: {package['Version']}")
        print(f"  License: {package['License']}")
        print(f"  URL: {package['URL']}")
        print(f"  Author: {package['Author']}")
        print()

if __name__ == "__main__":
    # Step 1: Audit dependencies
    audit_dependencies()

    # Step 2: Display dependencies
    display_dependencies()
