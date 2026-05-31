from db.database import engine
from db.models import Base

def create_tables():
    Base.metadata.create_all(bind=engine)