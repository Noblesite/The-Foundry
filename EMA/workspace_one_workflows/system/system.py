import requests
import json
from datetime import date
from typing import List, Dict, Optional
from dataclasses import dataclass
from workspace_one_workflows.workspace_one_auth import WorkspaceOneAuth
from workspace_one_workflows.aw_environment import AWEnviroment
from utilities.logger import get_logger
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class System:
    def __init__(self, env: str):
        self.awEnviroment = AWEnviroment(env)
        self.workSpaceOneAuth = WorkspaceOneAuth()
        self.logger = get_logger(__class__)
        
        # ✅ Fetch required values from AWEnviroment
        self.api_url = self.awEnviroment.api_url
        self.rds = self.awEnviroment.rds
        self.tenant_code = self.awEnviroment.tenant_code
        self.environment = self.awEnviroment.environment  # ✅ Fixed missing reference
        
        # ✅ Session with automatic retries for transient failures
        self.session = requests.Session()
        retries = Retry(total=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
        self.session.mount("https://", HTTPAdapter(max_retries=retries))

    def _get_headers(self, url: str) -> Dict[str, str]:
        """Generate headers required for API requests, including authentication."""
        authorization = self.workSpaceOneAuth.get_cmsurl_header(url)
        return {
            "Authorization": authorization,
            "aw-tenant-code": self.tenant_code,
            "Content-Type": "application/json"
        }

    def _send_request(self, method: str, url: str, json_data: Optional[Dict] = None) -> Dict:
        """Helper function to make API requests with error handling and retries."""
        headers = self._get_headers(url)
        self.logger.info(f"🔄 Sending {method} request to {url}")

        try:
            response = self.session.request(method, url, headers=headers, json=json_data, timeout=90)
            response.raise_for_status()  # Raise HTTPError for bad responses

            self.logger.info(f"✅ {method} request successful. Status: {response.status_code}")
            return response.json() if response.text else {}

        except requests.RequestException as e:
            self.logger.error(f"❌ API Request Failed: {e}")
            return {"error": str(e)}

    def search_custom_user_group(self, name: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/custom/search?groupname={name}"
        return self._send_request("GET", url)

    def create_custom_user_group(self, group_name: str, organization_group: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/createcustomusergroup"
        payload = {
            "GroupName": group_name,
            "Description": f"Newman generated User Group. Created on: {date.today()}",
            "ManagedByOrganizationGroupID": organization_group
        }
        return self._send_request("POST", url, json_data=payload)

    def retrieve_list_of_users_from_group(self, user_group_id: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/{user_group_id}/users?pagesize=20000"
        return self._send_request("GET", url)

    def search_for_enrollment_user(self, username: str) -> Dict:
        url = f"{self.api_url}/system/users/search?username={username}"
        return self._send_request("GET", url)

    def register_device_to_enrollment_user(self, user_id: str, first_name: str, location_group_id: str, ownership: str) -> Dict:
        url = f"{self.api_url}/system/users/{user_id}/registerdevice"
        message_id = "529" if self.environment == "cn223" else "396"
        payload = {
            "FriendlyName": f"{first_name}'s Device",
            "LocationGroupId": location_group_id,
            "Ownership": ownership,
            "MessageTemplateId": message_id,
            "MessageType": "Email"
        }
        return self._send_request("POST", url, json_data=payload)

    def create_new_enrollment_user(self, username: str) -> Dict:
        url = f"{self.api_url}/system/users/adduser"
        payload = {
            "UserName": username,
            "Status": "True",
            "SecurityType": 1,
            "MessageType": "None",
            "Role": "Basic Access",
            "LocationGroupId": self.rds
        }
        return self._send_request("POST", url, json_data=payload)

    def delete_custom_user_group(self, user_group_id: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/{user_group_id}/delete"
        return self._send_request("DELETE", url)

    def get_all_ogs_under_retail_production(self) -> Dict:
        """✅ Fixed `self.airwatch` reference to use `self.awEnviroment`."""
        url = f"{self.api_url}/system/groups/{self.awEnviroment.get_retail_production()}/children"
        return self._send_request("GET", url)

    def add_user_to_custom_group(self, user_group: str, user_id: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/{user_group}/user/{user_id}/addusertogroup"
        return self._send_request("POST", url)

    def remove_user_from_custom_group(self, user_group: str, user_id: str) -> Dict:
        url = f"{self.api_url}/system/usergroups/{user_group}/user/{user_id}/removeuserfromgroup"
        return self._send_request("POST", url)

    def get_enrollment_user_by_uuid(self, uuid: str) -> Dict:
        url = f"{self.api_url}/system/users/{uuid}"
        return self._send_request("GET", url)

    def get_organization_group_info(self, org_id: str) -> Dict:
        url = f"{self.api_url}/system/groups/{org_id}"
        return self._send_request("GET", url)

    def create_new_organization_group(self, organization_group_name: str, organization_group_id: str, parent_og_id: str) -> Dict:
        url = f"{self.api_url}/system/groups/{parent_og_id}"
        payload = {
            "Name": organization_group_name,
            "GroupId": organization_group_id,
            "LocationGroupType": "Container",
            "Country": "US",
            "Locale": "en-US",
            "AddDefaultLocation": "No",
            "EnableRestApiAccess": True
        }
        return self._send_request("POST", url, json_data=payload)