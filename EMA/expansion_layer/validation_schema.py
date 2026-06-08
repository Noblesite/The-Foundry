from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict


class QAPairSchema(BaseModel):
    """
    Validation schema for QA pairs to ensure data consistency and quality.
    """

    question: str = Field(
        ...,
        max_length=512,
        description="The question being asked."
    )
    answer: str = Field(
        ...,
        max_length=512,
        description="The correct answer to the question."
    )
    context: str = Field(
        ...,
        max_length=2048,
        description="The context or passage from which the question is derived."
    )
    type: Optional[str] = Field(
        None,
        description="The type of question. E.g., fact-based, multiple-choice, true-false."
    )
    metadata: Optional[Dict] = Field(
        None,
        description="Additional metadata about the QA pair."
    )
    difficulty_level: Optional[str] = Field(
        None,
        description="Difficulty level of the question."
    )
    options: Optional[List[str]] = Field(
        None,
        description="Options for multiple-choice questions."
    )
    language: Optional[str] = Field(
        "en",
        description="Language of the question and answer."
    )

    @model_validator(mode='before')
    def check_multiple_choice(cls, values):
        """
        Ensure that multiple-choice questions have options provided.
        """
        if values.get("type") == "multiple-choice" and not values.get("options"):
            raise ValueError("Multiple-choice questions must have options.")
        return values

    class Config:
        json_schema_extra = {
            "example": {
                "question": "What is AirWatch?",
                "answer": "AirWatch is an enterprise mobility management solution.",
                "context": "AirWatch allows administrators to manage devices remotely.",
                "type": "fact-based",
                "metadata": {
                    "source": "ChromaDB",
                    "tags": ["API", "management"]
                },
                "difficulty_level": "easy",
                "options": None,
                "language": "en"
            }
        }


    class Config_two: {
        "example": {
            "question": "",
            "context": "N/A",
            "answer": "No answer provided.",
            "type": "fact-based",
            "category": "api",
            "metadata": {
                "api_category": "",
                "api_name": "",
                "method": "",
                "url": ""
            }
        }
    }



    #"question": "What is the purpose of the AndroidWorkAppsV1 API?",
    #   "answer": "",
    #"type": "fact_based",
    #"category": "api",
    #     "metadata": {
    #    "api_category": "MAM API V1",
    #    "api_name": "AndroidWorkAppsV1",
    #    "functionality": "Mobile Application Management (MAM) focuses on managing mobile apps on enterprise devices.",
    #    "description": "New - Import approved Android Enterprise apps to AirWatch",
    #    "method": "POST",
    #    "url": "{{baseUrl}}/mam/groups/:uuid/androidwork/apps/import",
    #    "headers": [
    #        {
    #            "key": "Accept",
    #            "value": "application/json;version=1"
    #        }
    #    ],
    #    "variables": [
    #        {
    #            "key": "uuid",
    #            "value": "urn:uuid:f4336145-309d-5e40-b096-a4295dc345d3",
    #            "description": "(Required) Unique Identifier for the organization group(Required)"
    #        }
    #    ],
    #    "query_parameters": [],
    #    "request_body": "No request body provided",
    #    "responses": [
    #        {
    #            "code": 200,
    #            "status": "OK",
    #            "body": "[\n\t{\n\t\t\"applicationName\": \"ipsum anim cupidatat aliqua fugiat\",\n\t\t\"uniqueApplicationIdentifier\": \"i\",\n\t\t\"id\": -82646019,\n\t\t\"uuid\": \"00000000-0000-0000-0000-000000000000\"\n\t},\n\t{\n\t\t\"applicationName\": \"aliqua officia\",\n\t\t\"uniqueApplicationIdentifier\": \"adipisicing consectetu\",\n\t\t\"id\": 4466621,\n\t\t\"uuid\": \"00000000-0000-0000-0000-000000000000\"\n\t}\n]"
    #        },
    #        {
    #            "code": 204,
    #            "status": "No Content",
    #            "body": ""
    #        },
    #        {
    #            "code": 412,
    #            "status": "Precondition Failed",
    #            "body": "{\n\t\"errorCode\": -54289884,\n\t\"message\": {},\n\t\"activityId\": \"00000000-0000-0000-0000-000000000000\",\n\t\"links\": [\n\t\t{\n\t\t\t\"Rel\": \"pariatur dolor\",\n\t\t\t\"Href\": \"aute sunt ex in\",\n\t\t\t\"Title\": \"quis nulla\"\n\t\t},\n\t\t{\n\t\t\t\"Rel\": \"ullamco aute\",\n\t\t\t\"Href\": \"officia dolor sunt\",\n\t\t\t\"Title\": \"irure sunt amet\"\n\t\t}\n\t]\n}"
    #        }
    #    ]
    #}
#}""