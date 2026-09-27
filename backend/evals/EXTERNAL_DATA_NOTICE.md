# Third-party data in external.jsonl

`external.jsonl` contains sampled and lightly adapted questions from two public datasets. They keep their original licenses.

- **ABCD, Action-Based Conversations Dataset**, ASAPP Research. MIT License. https://github.com/asappresearch/abcd
  First customer requests from conversations, unmodified.
- **Bitext customer support LLM chatbot training dataset**, Bitext Innovations. Community Data License Agreement, Sharing, Version 1.0.
  https://github.com/bitext/customer-support-llm-chatbot-training-dataset
  Placeholders were filled in, and for in-scope intents "order"/"purchase" were reworded to "reservation" (marked `adapted: true`).
  Under CDLA-Sharing, this derived sample is shared under the same agreement.

Labels mapping these questions to Hearth's help articles and queues are this project's own (see `scripts/build_external.py`).
