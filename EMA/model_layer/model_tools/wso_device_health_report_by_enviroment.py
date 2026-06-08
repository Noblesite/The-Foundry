import json
from workspace_one_workflows.workflows.device_health_report import DeviceHealthReportInterface

class WSODeviceHealthReportByEnviroment():
    def __init__(self):
        self.name: str = "wso_device_health_report_by_enviroment"
        self.description: str = (
        "Fetches all devices for a given organization group ID from Workspace ONE."
        "Provide an organization group ID and Workspace ONE environment."
        )

    def _run(self, organization_group_id: int, environment: str) -> str:
        if not organization_group_id:
            return json.dumps({"error": "Organization group ID is required."}, indent=2)
        
        device_health_report = DeviceHealthReportInterface(environment=environment)
        response = device_health_report.run_airwatch_device_health_check(organization_group_id=organization_group_id)
        return json.dumps(response, indent=2)

    async def _arun(self, organization_group_id: int) -> str:
        raise NotImplementedError("Async execution is not supported for this tool.")