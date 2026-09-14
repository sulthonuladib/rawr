-- Custom SQL migration file, put your code below! --
INSERT INTO "exchanges" ("slug", "name") VALUES
	('binance', 'Binance'),
	('indodax', 'Indodax'),
	('huobi', 'Huobi'),
	('bybit', 'Bybit'),
	('okx', 'OKX'),
	('kucoin', 'KuCoin'),
	('mexc', 'MEXC'),
	('bittime', 'Bittime'),
	('bitget', 'Bitget'),
	('gateio', 'Gate.io'),
	('upbit', 'Upbit'),
	('upbit_usdt', 'Upbit USDT'),
	('pintu', 'Pintu'),
	('reku', 'Reku'),
	('bitmart', 'BitMart')
ON CONFLICT ("slug") DO NOTHING;
