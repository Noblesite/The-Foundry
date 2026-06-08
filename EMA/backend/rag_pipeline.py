from ray import serve
from backend.api_server import app  # Import the FastAPI app
from utilities.logger import get_logger  # Centralized logger
from prometheus_client import Gauge
from data_layer.vector_database import VectorDatabase  # Database integration

# Initialize the logger
logger = get_logger(__name__)

# Metrics for monitoring pipeline usage
query_request_count = Gauge(
    "query_request_count", "Number of query requests processed by the RAG pipeline"
)
chat_request_count = Gauge(
    "chat_request_count", "Number of chat requests processed by the RAG pipeline"
)

@serve.deployment(
    name="rag_pipeline",
    num_replicas=2,
    route_prefix="/",
    ray_actor_options={"num_cpus": 1},
)
@serve.ingress(app)
class RAGPipeline:
    """
    RAGPipeline integrates the FastAPI app with Ray Serve for scalable deployment.
    It handles query and chat requests, tracks usage metrics, and logs activity.
    """

    def __init__(self):
        logger.info("RAGPipeline initialized with 2 replicas.")
        self.db = VectorDatabase()  # Initialize the database connection

    async def handle_query(self, query: str):
        """
        Handles a query request.
        
        :param query: User query
        :return: Response from RAG pipeline
        """
        try:
            query_request_count.inc()
            logger.info(f"Processing query: {query}")

            # Retrieve results from the database
            results = self.db.query(query)

            # Validate results
            if not results or "documents" not in results:
                raise ValueError("No documents found in query results.")

            # Generate response
            prompt = self.db.generate_prompt_from_results(results, query)
            logger.debug(f"Generated prompt: {prompt}")
            return prompt
        except Exception as e:
            logger.error(f"Error in RAG pipeline during query handling: {e}")
            raise

    async def handle_chat(self, message: str):
        """
        Handles a chat request.
        
        :param message: Chat message
        :return: Response from RAG pipeline
        """
        try:
            chat_request_count.inc()
            logger.info(f"Processing chat message: {message}")

            # Example: Simulate a response (Replace with LLM integration)
            response = {"reply": f"Simulated chat response for: {message}"}
            return response
        except Exception as e:
            logger.error(f"Error in RAG pipeline during chat handling: {e}")
            raise

# Deploy the pipeline
if __name__ == "__main__":
    import ray

    # Start Ray if not already started
    if not ray.is_initialized():
        ray.init()
        logger.info("Ray initialized.")

    try:
        serve.start(detached=True)  # Start Ray Serve in detached mode
        serve.run(RAGPipeline.bind())  # Deploy the RAGPipeline
        logger.info("RAGPipeline successfully deployed.")
    except Exception as e:
        logger.error(f"Failed to deploy RAGPipeline: {e}")
        raise

    logger.info("RAGPipeline is running.")