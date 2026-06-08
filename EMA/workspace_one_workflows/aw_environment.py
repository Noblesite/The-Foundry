import os
from dotenv import load_dotenv
from utilities.logger import get_logger

class AWEnviroment:
    def __init__(self, aw_env: str):
        """Sets AirWatch Enviroment veriables."""
        # Load env values
        load_dotenv()
        # load logging 
        logger = get_logger(__name__)
        # Set values for instinced enviroment 
        match aw_env:
            case "cn88":
                self.api_url = os.getenv("CN88_API_URL")
                self.tenant_code = os.getenv("CN88_TENANT_CODE")
                self.parent_og = os.getenv("CN88_PARENT_OG_ID")
            case "cn223":
                self.api_url = os.getenv("CN223_API_URL")
                self.tenant_code = os.getenv("CN223_TENANT_CODE")
                self.parent_og = os.getenv("CN223_PARENT_OG_ID")
            case "cn885":
                self.api_url = os.getenv("CN885_API_URL")
                self.tenant_code = os.getenv("CN885_TENANT_CODE")
                self.parent_og = os.getenv("CN885_PARENT_OG_ID")
            case "cn908":
                self.api_url = os.getenv("CN908_API_URL")
                self.tenant_code = os.getenv("CN908_TENANT_CODE")
                self.parent_og = os.getenv("CN908_PARENT_OG_ID")
            case _:
                self.api_url = os.getenv("CN223_API_URL")
                self.tenant_code = os.getenv("CN223_TENANT_CODE")
                self.parent_og = os.getenv("CN223_PARENT_OG_ID")

        logger.info(f"Setting value for AW enviroment: {self.api_url}")
        

