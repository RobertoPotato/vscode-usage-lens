class MeterService:
    def __init__(self, readings):
        self.readings = readings

    def calculate_consumption(self):
        return sum(self.readings)

    def summary(self):
        return f"total={self.calculate_consumption()}"


def unused_function():
    return None
