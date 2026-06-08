# **Semantic Templates**

Semantic templates are structured configurations used to dynamically generate natural language responses, queries, or instructions based on metadata and user input. These templates allow systems to interpret, refine, and execute user queries by applying predefined rules, filters, and contextual data.

---

## **Template Structure**

A semantic template typically consists of several key components:

### **Template Properties**

- **name**:  
  A unique name for the template. This name helps identify the template in logs or debugging processes.  
  **Example**: `"Retrieve Device Info"`

- **description**:  
  A brief explanation of the template's purpose or use case.  
  **Example**: `"This template is used to retrieve information about a device."`

### **Keywords**

- **keywords**:  
  A list of terms or phrases associated with the template. Keywords are used to match user queries with the appropriate template.  
  **Example**:  
  ```yaml
  keywords:
    - "device"
    - "status"
    - "last seen"
  ```

### **Metadata Filters**

- **metadata_filters**:  
  Conditions applied to filter database queries based on metadata. Each filter defines:  
  - **key**: The metadata field to filter on.  
  - **operator**: The logical operation to perform (`equals`, `contains`, `exists`, etc.).  
  - **value**: The value to match against.  

  **Example**:  
  ```yaml
  metadata_filters:
    - key: "device_type"
      operator: "equals"
      value: "mobile"
    - key: "last_seen"
      operator: "exists"
  ```

### **Fields**

- **fields**:  
  Important attributes within the template. Each field describes a key piece of information, its relative importance (weight), and its role in generating the output.  

  **Example**:  
  ```yaml
  fields:
    - key: "device_name"
      weight: 10
      description: "The name of the device as it appears in the database."
    - key: "last_seen"
      weight: 5
      description: "The timestamp when the device was last active."
  ```

### **Template Structure**

- **template_structure**:  
  A natural language framework that integrates user input and metadata dynamically. This structure provides the LLM or query processor with a contextualized prompt.  

  **Example**:  
  ```yaml
  template_structure: |
    "Retrieve all devices where the device type is '{device_type}' and last seen exists. Include details such as the device name and last seen timestamp."
  ```

---

## **Full Example**

```yaml
templates:
  - name: "Device Status Query"
    description: "Used to query the status of devices in the database."
    keywords:
      - "device"
      - "status"
      - "last seen"
    metadata_filters:
      - key: "device_type"
        operator: "equals"
        value: "mobile"
      - key: "last_seen"
        operator: "exists"
    fields:
      - key: "device_name"
        weight: 10
        description: "The name of the device as it appears in the database."
      - key: "last_seen"
        weight: 5
        description: "The timestamp when the device was last active."
    template_structure: |
      "Retrieve all devices where the device type is '{device_type}' and last seen exists. Include details such as the device name and last seen timestamp."
```

---

## **How It Works**

1. **Matching a Template**  
   User input is analyzed to identify keywords and match the appropriate template.

2. **Applying Metadata Filters**  
   Filters are dynamically applied to narrow down query results from the database.

3. **Generating a Query or Response**  
   The `template_structure` is filled with values from metadata or user input to create a contextual and actionable output.

---

## **Benefits of Semantic Templates**

- **Consistency**: Ensures uniform query construction and response generation.  
- **Scalability**: Easily expand by adding new templates for additional use cases.  
- **Adaptability**: Handles user-specific metadata and filters dynamically.  
- **Clarity**: Simplifies understanding and debugging with structured, reusable templates.

This setup is ideal for integrating with **Retrieval-Augmented Generation (RAG)** pipelines, enabling seamless interactions between user inputs, metadata, and knowledge bases like **ChromaDB**.

---

