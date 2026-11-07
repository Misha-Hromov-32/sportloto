import pytest

from app.domain import provider
from app.domain.lib.cities import city_by_name
from tests.test_calendar_scaling import calendar_domain


@pytest.mark.parametrize('district,point_city,expected_city', [
    (None, 'Брянск', 'Брянск'),
    ('d-bry-sov', 'Красноярск', 'Брянск'),
    (None, None, 'Красноярск'),
])
def test_announcement_city_follows_location_before_author_home(calendar_domain, district, point_city, expected_city):
    domain, database = calendar_domain
    row = domain.create_companion(domain.user('u-dmitry'), {
        'sportId': 's-running', 'text': 'Ищу компанию для пробежек в выбранном городе',
        'districtId': district,
        'point': city_by_name(point_city)['center'] if point_city else None,
        'when': 'Будни вечером', 'level': 'beginner',
    })
    for city in ('Брянск', 'Красноярск', 'Москва'):
        with provider.acting_as(None):
            result = provider.get_list('companions', [{'field': 'city', 'operator': 'eq', 'value': city}], pagination={'mode':'off'})
        assert (row['id'] in {c['id'] for c in result['data']}) is (city == expected_city)
