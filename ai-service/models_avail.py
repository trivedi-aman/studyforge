from groq import Groq

client = Groq(api_key="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")

models = client.models.list()

print(f"Total models: {len(models.data)}\n")

for model in models.data:
    print(model.id)
