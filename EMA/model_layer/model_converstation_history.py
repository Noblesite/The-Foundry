class ConversationMemory:
    def __init__(self, max_history=50):
        """
        Initializes the conversation memory.
        - `max_history`: Maximum number of messages to retain.
        """
        self.max_history = max_history  # Controls conversation length
        self.conversation_history = []  # Stores conversation messages

    def add_message(self, message):
        """
        Adds a message to the conversation history.
        - Ensures the history does not exceed `max_history`.
        """
        self.conversation_history.append(message)
        
        # Maintain history limit
        if len(self.conversation_history) > self.max_history:
            self.conversation_history.pop(0)  # Remove oldest message

    def get_history(self)->list:
        """
        Retrieves the conversation history.
        """

        return self.conversation_history

    def clear_history(self):
        """Clears the conversation history."""
        self.conversation_history = []
