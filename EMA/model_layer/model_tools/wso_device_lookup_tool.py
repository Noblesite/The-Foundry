
import json
from workspace_one_workflows.workflows.device_look_up import DeviceExtensiveSearch

class WSODeviceLookupTool():
    def __init__(self):
        self.name = "wso_device_lookup_tool"
        self.description = (
        "Fetches details of a specific device using a serial number or device ID from Workspace ONE."
        )

    def _run(self,  environment: str, serial_number: str = None, device_id: int = None) -> str:
        if not serial_number and not device_id:
            return json.dumps({"error": "Provide a serial number or device ID."}, indent=2)

        try:
            device_extensive_search = DeviceExtensiveSearch(environment=environment)
            responses = [
                device_extensive_search.get_device_extensive_search(device_serial_number=serial_number) if serial_number else None,
                device_extensive_search.get_device_extensive_search(device_id=device_id) if device_id else None
            ]
            responses = [resp for resp in responses if resp is not None]
            return json.dumps(responses, indent=2) if responses else json.dumps({"error": "No valid device found."}, indent=2)
        
        except Exception as e:
            return json.dumps({"error": f"Failed to fetch device details: {str(e)}"}, indent=2)

    async def _arun(self, serial_number: str = None, device_id: int = None) -> str:
        raise NotImplementedError("Async execution is not supported for this tool.")