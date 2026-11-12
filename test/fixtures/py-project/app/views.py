from app.services import MeterService


def index():
    svc = MeterService([1, 2, 3])
    return svc.calculate_consumption()
