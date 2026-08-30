from groq import Groq

client = Groq(api_key="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")

models = client.models.list()

print(f"Total models: {len(models.data)}\n")

for model in models.data:
    print(model.id)



# GROQ_API_KEY_SUMMARIZATION=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
# GROQ_API_KEY_STRUCTURED=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
# GROQ_API_KEY_RAG=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
# GROQ_API_KEY_LIGHT=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