from utilities.logger import get_logger
from workspace_one_workflows.mdm.mdm import MDM

class DeviceExtensiveSearch:
    def __init__(self, environment: str):
        self.mdm = MDM(environment)
        self.logger = get_logger(__name__)

    def get_device_extensive_search(self, device_serial_number: str = None, device_id: int = None):
        """
        Searches for a device using either a serial number or a device ID.
        Returns structured JSON output.
        """
        try:
            # ✅ Validate input
            if not device_serial_number and not device_id:
                self.logger.error("❌ No valid parameters provided. Must specify either device_serial_number or device_id.")
                return {"error": "No valid parameters provided. Please provide a serial number or device ID."}

            # ✅ Perform search based on input type
            if device_serial_number:
                response = self.mdm.extensive_search_device_details(
                    device_identifier=device_serial_number, search_type="serialNumber"
                )
            elif device_id:
                response = self.mdm.extensive_search_device_details(
                    device_identifier=device_id, search_type="deviceId"
                )

            return response  # ✅ Ensures JSON-compatible output

        except Exception as e:
            self.logger.error(f"❌ Device lookup failed: {str(e)}")
            return {"error": str(e)}