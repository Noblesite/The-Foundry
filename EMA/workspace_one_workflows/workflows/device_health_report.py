import math
import yaml
from utilities.logger import get_logger
from workspace_one_workflows.mdm.mdm import MDM

class DeviceHealthReportInterface:
    def __init__(self, environment: str):
        self.mdm = MDM(environment)
        self.logger = get_logger(__name__)

        # Load config from YAML
        with open("config.yaml", "r") as file:
            config = yaml.safe_load(file)
        self.page_size = config.get("device_health_page_size", 5000)

    def run_airwatch_device_health_check(self, organization_group_id: int):
        """Fetch all pages of device health data and return the full dataset."""
        self.device_health_check_tracker = DeviceHealthReportTracker(
            organization_group_id=organization_group_id,
            page_size=self.page_size
        )

        org_id = self.device_health_check_tracker.get_organization_group_id()
        all_device_data = []  # ✅ Store paged responses

        try:
            # Get the total count of devices to determine pagination
            request = self.mdm.get_device_health_check(org_id, 1, 0)
            total_devices = request.get("Total", 0)
            self.device_health_check_tracker.set_max_amount_of_pages(
                total_devices,
                self.device_health_check_tracker.get_page_size()
            )
        except Exception as e:
            self.logger.error(f"Failed to get initial device count: {e}")
            return []

        while self.device_health_check_tracker.get_make_next_call():
            try:
                # Fetch a page of results
                api_response = self.mdm.get_device_health_check(
                    org_id,
                    self.device_health_check_tracker.get_page_size(),
                    self.device_health_check_tracker.get_page_counter()
                )
                
                # ✅ Append response data
                all_device_data.extend(api_response.get("Devices", []))  

                # ✅ Increment page count
                self.device_health_check_tracker.increment_page()
            except Exception as e:
                self.logger.error(f"API call failed: {e}")
                all_device_data = [e];
                break

        return all_device_data  # ✅ Return all collected pages as a list

class DeviceHealthReportTracker:
    def __init__(self, organization_group_id: int, page_size: int):
        self.logger = get_logger(__name__)

        try:
            self.make_next_call = True
            self.error_message = []
            self.page_counter = 0
            self.total_devices = 0
            self.max_amount_of_pages = 0
            self.success = False
            self.organization_group_id = organization_group_id
            self.page_size = page_size
        except Exception as e:
            self.logger.error(f"DeviceHealthReportTracker initialization error: {e}")
            self.error_message.append("DeviceHealthReportCaller issues mapping values")

        self.set_success()

    def set_success(self):
        self.success = not bool(self.error_message)

    def set_max_amount_of_pages(self, total_devices, page_size):
        """Calculates and sets the maximum number of pages correctly."""
        self.max_amount_of_pages = math.ceil(total_devices / page_size)

    def increment_page(self):
        """Increments the page counter safely."""
        if self.page_counter < self.max_amount_of_pages:
            self.page_counter += 1
            self.make_next_call = True
        else:
            self.make_next_call = False

    def get_organization_group_id(self):
        return self.organization_group_id

    def get_page_size(self):
        return self.page_size

    def get_make_next_call(self):
        return self.make_next_call