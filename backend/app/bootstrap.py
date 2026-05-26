import asyncio

from app.database import init_models


def main() -> None:
    asyncio.run(init_models())


if __name__ == "__main__":
    main()