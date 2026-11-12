from groq import Groq

client = Groq(api_key=os.environ["GROQ_API_KEY_LIGHT"])

models = client.models.list()

print(f"Total models: {len(models.data)}\n")

for model in models.data:
    print(model.id)
